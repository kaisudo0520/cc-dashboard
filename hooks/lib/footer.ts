// The Footer's hotkey hints. Only the keys that do something are named: 1 folds
// the quota header; 2 folds the 分支 panel and u unfolds its list of paths, so
// those two are named only while the panel is there (and has a list to open).

export const footerHint = (hasGit: boolean, canUnfoldList: boolean): string =>
  ['1額度', ...(hasGit ? ['2分支'] : []), ...(hasGit && canUnfoldList ? ['u路徑'] : [])].join(' ')
