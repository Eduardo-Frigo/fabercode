const core = require('./deterministic_edit_core');
const structural = require('./deterministic_edit_structural');
const transforms = require('./deterministic_edit_transforms');
const styles = require('./deterministic_edit_styles');

module.exports = {
  ...core,
  ...structural,
  ...transforms,
  ...styles,
};
