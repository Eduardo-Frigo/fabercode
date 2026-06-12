const assert = require('assert');

const {
  createCustomProviderProfileService,
} = require('../main/runtime/custom_provider_profile');

function run() {
  const service = createCustomProviderProfileService({
    getSelectedAiProvider: () => 'custom:openai-staging',
    listCustomApiProfiles: () => [
      { id: 'openai-staging', providerName: 'OpenAI', website: '' },
    ],
  });
  assert.strictEqual(service.resolveCustomProviderKind('Google Gemini'), 'gemini');
  assert.strictEqual(service.resolveCustomApiEndpoint({ providerName: 'DeepSeek' }), 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(service.resolveCustomApiEndpoint({ providerName: 'Other', website: 'https://api.example.com/v1' }), 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(service.getSelectedCustomApiProfile().id, 'openai-staging');
  assert.strictEqual(service.maskApiKeyTail('abcdef'), '**cdef');
  console.log('custom-provider-profile.test.js: ok');
}

run();
