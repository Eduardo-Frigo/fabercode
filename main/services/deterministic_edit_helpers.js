const core = require('./deterministic_edit_core');
const transforms = require('./deterministic_edit_transforms');
const styles = require('./deterministic_edit_styles');

module.exports = {
  ...core,
  ...transforms,
  ...styles,
};
