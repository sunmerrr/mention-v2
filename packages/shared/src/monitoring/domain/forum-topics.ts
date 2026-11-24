export const forumKeywordIdentity = (word: string) =>
  word
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
