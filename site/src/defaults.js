// What every new install starts with, so that opening the app is all anybody has to do:
//
//   - the wall: the app downloads this wall pack (it is published next to the app, in the repository's `wall` folder) and
//     imports it the first time it opens;
//   - the board: once the person has an account, the app joins this shared board for that wall, so the climbs other people
//     uploaded appear and the person can upload their own.
//
// The board code is the password to the board. Putting it here, in a public repository, makes the board open to everyone
// who installs the app (anyone can make an account and upload climbs to it), which is what an open community board is. A
// private board for friends is still possible: Sync with friends -> Start a board gives a new code. Set `board` to null to
// have no automatic board, or change `wall` and `board` to make another wall the default in your own copy.

// What the app remembers (in its own database) about having done these, so that a wall you deleted or a board you left does
// not come back by itself.
export const MEMORY = { wall: 'defaults:wall', board: 'defaults:board' };

export const DEFAULTS = {
  wall: { key: 'av-wall', pack: 'wall/av-wall.zip' },
  board: { wallKey: 'av-wall', code: 'mh6g-p7rt-2aaj-h5jp' },
};
