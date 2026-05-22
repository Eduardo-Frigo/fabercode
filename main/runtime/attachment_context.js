const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tiff', '.tif']);

function createAttachmentContextService(dependencies = {}) {
  const {
    clipTextPreserveLines,
    fs,
    isTextLikeExtension,
    path,
    runCommand,
  } = dependencies;

  function isImageLikeExtension(ext) {
    return IMAGE_EXTENSIONS.has(String(ext || '').toLowerCase());
  }

  async function extractImageTextViaMdls(filePath) {
    const mdlsResult = await runCommand('mdls', ['-name', 'kMDItemTextContent', '-raw', filePath], {
      timeoutMs: 8000,
    });
    if (!mdlsResult.ok) return '';
    const text = String(mdlsResult.stdout || '').trim();
    if (!text || text === '(null)') return '';
    return clipTextPreserveLines(text, 12000);
  }

  async function extractImageTextViaVision(filePath) {
    const swiftScript = [
      'import Foundation',
      'import Vision',
      'import AppKit',
      'let path = CommandLine.arguments.last ?? ""',
      'if path.isEmpty { exit(2) }',
      'let url = URL(fileURLWithPath: path)',
      'guard let image = NSImage(contentsOf: url) else { exit(3) }',
      'var rect = CGRect(origin: .zero, size: image.size)',
      'guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { exit(4) }',
      'let request = VNRecognizeTextRequest()',
      'request.recognitionLevel = .accurate',
      'request.usesLanguageCorrection = true',
      'request.recognitionLanguages = ["pt-BR", "en-US"]',
      'let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])',
      'do {',
      '  try handler.perform([request])',
      '  let items = (request.results as? [VNRecognizedTextObservation] ?? [])',
      '    .compactMap { $0.topCandidates(1).first?.string }',
      '    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }',
      '    .filter { !$0.isEmpty }',
      '  print(items.joined(separator: "\\n"))',
      '} catch {',
      '  exit(5)',
      '}',
    ].join('\n');

    const swiftResult = await runCommand('xcrun', ['swift', '-e', swiftScript, filePath], {
      timeoutMs: 22000,
    });
    if (!swiftResult.ok) return '';
    const text = String(swiftResult.stdout || '').trim();
    if (!text) return '';
    return clipTextPreserveLines(text, 12000);
  }

  async function extractAttachmentText(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    if (!filePath || !fs.existsSync(filePath)) return '';

    if (isTextLikeExtension(ext)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return clipTextPreserveLines(raw, 12000);
    }

    if (ext === '.pdf') {
      const text = await extractImageTextViaMdls(filePath);
      if (text) return text;
    }

    if (isImageLikeExtension(ext)) {
      const mdlsText = await extractImageTextViaMdls(filePath);
      if (mdlsText) return mdlsText;

      const visionText = await extractImageTextViaVision(filePath);
      if (visionText) return visionText;
    }

    return '';
  }

  async function buildAttachmentsPromptContext(attachments = [], { maxAttachments = 4, maxCharsPerAttachment = 1200, totalMaxChars = 4200 } = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return '';

    const selected = attachments
      .filter((entry) => entry && typeof entry === 'object')
      .filter((entry) => typeof entry.path === 'string' && entry.path.trim())
      .slice(0, Math.max(1, maxAttachments));

    if (!selected.length) return '';

    const blocks = [];
    let usedChars = 0;

    for (const attachment of selected) {
      const filePath = String(attachment.path || '').trim();
      if (!filePath) continue;

      const extracted = await extractAttachmentText(filePath);
      if (!extracted) continue;

      const name = attachment.name || path.basename(filePath);
      const type = attachment.type || path.extname(filePath).slice(1) || 'anexo';
      const excerpt = clipTextPreserveLines(extracted, Math.max(240, maxCharsPerAttachment));
      if (!excerpt) continue;

      const block = `[${name} | ${type}]\n${excerpt}`;
      const blockLen = block.length + 2;
      if (usedChars + blockLen > totalMaxChars && blocks.length > 0) break;

      blocks.push(block);
      usedChars += blockLen;
    }

    return blocks.join('\n\n');
  }

  return {
    buildAttachmentsPromptContext,
    extractAttachmentText,
    extractImageTextViaMdls,
    extractImageTextViaVision,
    isImageLikeExtension,
  };
}

module.exports = {
  createAttachmentContextService,
};
