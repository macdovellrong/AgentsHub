export type SetApplicationMenu = (menu: null) => void;

export function hideDefaultApplicationMenu(setApplicationMenu: SetApplicationMenu): void {
  setApplicationMenu(null);
}
