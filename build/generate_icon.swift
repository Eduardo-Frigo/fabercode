import AppKit

let sizes: [Int] = [16, 32, 64, 128, 256, 512, 1024]

func makeImage(size: Int) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor(calibratedWhite: 0.10, alpha: 1.0).setFill()
    rect.fill()

    let inset = CGFloat(size) * 0.10
    let roundedRect = NSRect(x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
    let radius = CGFloat(size) * 0.18
    let path = NSBezierPath(roundedRect: roundedRect, xRadius: radius, yRadius: radius)

    let gradient = NSGradient(colors: [
        NSColor(calibratedWhite: 0.68, alpha: 1.0),
        NSColor(calibratedWhite: 0.42, alpha: 1.0)
    ])!
    gradient.draw(in: path, angle: -90)

    NSColor(calibratedWhite: 0.85, alpha: 0.35).setStroke()
    path.lineWidth = max(1.0, CGFloat(size) * 0.015)
    path.stroke()

    image.unlockFocus()
    return image
}

func savePNG(image: NSImage, path: String) {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Falha ao gerar PNG")
    }
    try! pngData.write(to: URL(fileURLWithPath: path))
}

let folder = "build/icon.iconset"

for size in sizes {
    let image = makeImage(size: size)

    if size <= 512 {
        savePNG(image: image, path: "\(folder)/icon_\(size)x\(size).png")
    }

    if size <= 512 {
        let doubled = size * 2
        let image2x = makeImage(size: doubled)
        savePNG(image: image2x, path: "\(folder)/icon_\(size)x\(size)@2x.png")
    }
}
