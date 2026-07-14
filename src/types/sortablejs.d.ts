/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

declare module 'sortablejs' {
  export interface SortableEvent {
    oldIndex?: number;
    newIndex?: number;
  }

  export interface SortableOptions {
    handle?: string;
    ghostClass?: string;
    onEnd?: (event: SortableEvent) => void;
  }

  export default class Sortable {
    constructor(element: Element, options?: SortableOptions);
    static create(element: Element, options?: SortableOptions): Sortable;
    destroy(): void;
  }
}
