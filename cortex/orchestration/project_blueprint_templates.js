const { hasProfileBlueprintOperations } = require('./project_blueprint_utils');
const { resolveBlueprintTheme } = require('./project_blueprint_layout');
const {
  buildProfileBlueprintOperations,
  isSafeBlueprintPath,
} = require('./project_blueprint_profile_templates');
const {
  buildInstitutionalCss,
  buildInstitutionalHtml,
  buildInstitutionalJs,
  buildLampBlueprint,
  buildStaticWebBlueprint,
} = require('./project_blueprint_static_templates');
const {
  buildAtelierCatalogNextPage,
  buildNextTailwindBlueprint,
} = require('./project_blueprint_next_templates');
const { normalizeBlueprintMediaAssets } = require('./project_blueprint_template_utils');

function buildBlueprintOperations({ stack, brand, stackProfile = null, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [], layoutVariant = 'editorial_split', layoutRecipe = null }) {
  if (stackProfile && hasProfileBlueprintOperations(stackProfile)) {
    return buildProfileBlueprintOperations({ profile: stackProfile, brand });
  }
  if (stack === 'lamp') return buildLampBlueprint({ brand, contract, theme, mediaAssets, iconIntent });
  if (stack === 'next-tailwind') return buildNextTailwindBlueprint({ brand, contract, theme, mediaAssets, iconIntent, layoutVariant, layoutRecipe });
  return buildStaticWebBlueprint({ brand, contract, theme, mediaAssets, iconIntent });
}

module.exports = {
  buildAtelierCatalogNextPage,
  buildBlueprintOperations,
  buildInstitutionalCss,
  buildInstitutionalHtml,
  buildInstitutionalJs,
  buildNextTailwindBlueprint,
  isSafeBlueprintPath,
  normalizeBlueprintMediaAssets,
};
