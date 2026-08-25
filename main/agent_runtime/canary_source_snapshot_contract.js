'use strict';

const CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION =
  'canary-source-snapshot-provider.v1';

const CANARY_SOURCE_SNAPSHOT_PROVIDER_DIAGNOSTICS = Object.freeze({
  version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  rootReadMode: 'pinned_authority_reader',
  checkpointMode: 'verified',
  mutationObservation: 'exclusive_job',
});

module.exports = {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_DIAGNOSTICS,
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
};
