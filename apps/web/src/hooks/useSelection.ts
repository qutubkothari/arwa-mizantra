import { useState, useCallback } from 'react';

export function useSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Safety check: ensure items is always an array
  const safeItems = Array.isArray(items) ? items : [];

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(safeItems.map(item => item.id)));
  }, [safeItems]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === safeItems.length) {
      deselectAll();
    } else {
      selectAll();
    }
  }, [selectedIds.size, safeItems.length, selectAll, deselectAll]);

  const selectedItems = safeItems.filter(item => selectedIds.has(item.id));
  const hasSelections = selectedIds.size > 0;
  const isAllSelected = selectedIds.size === safeItems.length && safeItems.length > 0;

  return {
    selectedIds,
    isSelected,
    toggleSelection,
    selectAll,
    deselectAll,
    toggleSelectAll,
    selectedItems,
    hasSelections,
    isAllSelected,
  };
}