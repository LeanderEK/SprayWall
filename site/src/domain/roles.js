// What a hold is used for in a climb: the same four roles as the Kilter and Tension boards.
// The `code` is what gets stored and shared, so never rename one.
export const ROLES = [
  { code: 'start', label: 'Start', color: '#2BD84B' },
  { code: 'hand', label: 'Hand', color: '#29B6F6' },
  { code: 'finish', label: 'Finish', color: '#E040FB' },
  { code: 'foot', label: 'Foot', color: '#FFA726' },
];

export const roleByCode = new Map(ROLES.map((role) => [role.code, role]));
