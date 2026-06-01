/**
 * cy node id for a table name. In its own dependency-free module so the store
 * layer (`selectors`) and the recycle bin can share the one definition WITHOUT
 * importing the cytoscape-heavy `buildGraph` module (which would pull cytoscape
 * into the main bundle and defeat the lazy split). `deletedTables` is keyed by
 * this.
 */
export function nodeId(tableName: string): string {
  return 't:' + tableName.toLowerCase();
}
