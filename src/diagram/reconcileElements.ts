import type { Core, ElementDefinition, SingularElementReturnValue } from 'cytoscape';

export interface ReconcileElementsResult {
  addedNodeIds: Set<string>;
  removedNodeIds: Set<string>;
  addedEdgeIds: Set<string>;
  removedEdgeIds: Set<string>;
}

const RUNTIME_CLASSES = new Set(['highlight', 'dimmed', 'manual-selected']);

function definitionId(definition: ElementDefinition): string {
  return String(definition.data.id);
}

function definitionClasses(definition: ElementDefinition): string[] {
  if (Array.isArray(definition.classes)) return definition.classes.map(String);
  return typeof definition.classes === 'string'
    ? definition.classes.split(/\s+/).filter(Boolean)
    : [];
}

function updateElement(element: SingularElementReturnValue, definition: ElementDefinition): void {
  element.data(definition.data);
  const runtime = element.classes().filter((name) => RUNTIME_CLASSES.has(name));
  element.classes([...definitionClasses(definition), ...runtime]);
}

/**
 * Reconcile graph definitions by stable id. Existing node positions and
 * runtime route data stay on their Cytoscape elements; only actual additions
 * and removals allocate/destroy elements. `replaceAll` is reserved for a fresh
 * import, whose documented semantics intentionally discard the old layout.
 */
export function reconcileElements(
  cy: Core,
  definitions: readonly ElementDefinition[],
  replaceAll = false,
): ReconcileElementsResult {
  const nodes = definitions.filter((definition) => definition.group === 'nodes');
  const edges = definitions.filter((definition) => definition.group === 'edges');
  const wantedNodes = new Set(nodes.map(definitionId));
  const wantedEdges = new Set(edges.map(definitionId));
  const result: ReconcileElementsResult = {
    addedNodeIds: new Set(),
    removedNodeIds: new Set(),
    addedEdgeIds: new Set(),
    removedEdgeIds: new Set(),
  };

  cy.batch(() => {
    if (replaceAll) {
      cy.nodes().forEach((node) => {
        result.removedNodeIds.add(node.id());
      });
      cy.edges().forEach((edge) => {
        result.removedEdgeIds.add(edge.id());
      });
      cy.elements().remove();
    } else {
      cy.edges().forEach((edge) => {
        if (!wantedEdges.has(edge.id())) {
          result.removedEdgeIds.add(edge.id());
          edge.remove();
        }
      });
      cy.nodes().forEach((node) => {
        if (!wantedNodes.has(node.id())) {
          result.removedNodeIds.add(node.id());
          node.remove();
        }
      });
    }

    for (const definition of nodes) {
      const id = definitionId(definition);
      const current = cy.getElementById(id);
      if (current.empty()) {
        cy.add(definition);
        result.addedNodeIds.add(id);
      } else {
        updateElement(current, definition);
      }
    }
    for (const definition of edges) {
      const id = definitionId(definition);
      let current = cy.getElementById(id);
      const source = String(definition.data.source ?? '');
      const target = String(definition.data.target ?? '');
      if (
        !current.empty() &&
        (current.source().id() !== source || current.target().id() !== target)
      ) {
        current.remove();
        result.removedEdgeIds.add(id);
        current = cy.getElementById(id);
      }
      if (current.empty()) {
        cy.add(definition);
        result.addedEdgeIds.add(id);
      } else {
        updateElement(current, definition);
      }
    }
  });
  return result;
}
