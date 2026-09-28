// Reject malformed present values; only absent fields may use defaults.
export function validateLanes(config, catalog) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(config)) throw new Error('Lane configuration must be an object');
  if ('version' in config && ![1, 2].includes(config.version)) throw new Error('Unsupported lanes.json version');
  for (const [name, lane] of Object.entries(catalog)) {
    if (!(name in config)) continue;
    const choice = config[name];
    if (!object(choice)) throw new Error(`Invalid ${name} lane: expected an object`);
    for (const field of ['provider', 'model', 'effort']) {
      if (field in choice && (typeof choice[field] !== 'string' || !choice[field].trim())) {
        throw new Error(`Invalid ${name}.${field}: expected a nonempty string`);
      }
    }
    if ('provider' in choice && choice.provider !== lane.provider) throw new Error(`Incompatible provider for ${name}`);
    const modelLane = Object.values(catalog).find(candidate => candidate.options.some(option => option.id === choice.model));
    if (modelLane && modelLane.provider !== lane.provider) throw new Error(`Incompatible model provider for ${name}: ${choice.model}`);
    const known = lane.options.find(option => option.id === choice.model);
    if ('effort' in choice && known?.efforts && !known.efforts.includes(choice.effort)) {
      throw new Error(`Unsupported ${name} effort`);
    }
  }
}
