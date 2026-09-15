'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DuplicateMatch {
  id: string;
  matchScore: number;
  matchedFields: string[];
  data: any;
}

export interface DuplicateWarningProps {
  isOpen: boolean;
  exactMatches: DuplicateMatch[];
  fuzzyMatches: DuplicateMatch[];
  entityType: string;
  onProceed: () => void;
  onCancel: () => void;
  formatRecord?: (data: any) => React.ReactNode;
}

export default function DuplicateWarning({
  isOpen,
  exactMatches,
  fuzzyMatches,
  entityType,
  onProceed,
  onCancel,
  formatRecord,
}: DuplicateWarningProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) setAcknowledged(false);
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const hasExactMatches = exactMatches.length > 0;
  const hasFuzzyMatches = fuzzyMatches.length > 0;

  return createPortal(
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-[3000]">
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <svg
              className="h-8 w-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="ml-4 flex-1">
            <h3 className="text-lg font-semibold text-gray-900">
              {hasExactMatches ? 'Duplicate Detected!' : 'Similar Record Found'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {hasExactMatches
                ? `An exact duplicate ${entityType} already exists in the system.`
                : `A similar ${entityType} already exists in the system.`}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Exact Matches */}
        {hasExactMatches && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-red-700 mb-2">
              Exact Matches ({exactMatches.length})
            </h4>
            {exactMatches.map((match, index) => (
              <div
                key={match.id}
                className="bg-red-50 border border-red-200 rounded-lg p-3 mb-2"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="text-xs text-red-600 font-medium">
                    Matched Fields: {match.matchedFields.join(', ')}
                  </div>
                  <div className="text-xs bg-red-600 text-white px-2 py-1 rounded">
                    {match.matchScore}% Match
                  </div>
                </div>
                {formatRecord ? (
                  formatRecord(match.data)
                ) : (
                  <pre className="text-xs text-gray-700 overflow-auto">
                    {JSON.stringify(match.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Fuzzy Matches */}
        {hasFuzzyMatches && !hasExactMatches && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-amber-700 mb-2">
              Similar Records ({fuzzyMatches.length})
            </h4>
            {fuzzyMatches.map((match, index) => (
              <div
                key={match.id}
                className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="text-xs text-amber-600 font-medium">
                    Similar Fields: {match.matchedFields.join(', ')}
                  </div>
                  <div className="text-xs bg-amber-600 text-white px-2 py-1 rounded">
                    {match.matchScore}% Match
                  </div>
                </div>
                {formatRecord ? (
                  formatRecord(match.data)
                ) : (
                  <pre className="text-xs text-gray-700 overflow-auto">
                    {JSON.stringify(match.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Warning Message */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-yellow-800">
            <strong>⚠️ Warning:</strong> Creating a duplicate {entityType} may lead to:
          </p>
          <ul className="list-disc list-inside text-xs text-yellow-700 mt-2 space-y-1">
            <li>Data inconsistency and reporting errors</li>
            <li>Confusion in operations and order processing</li>
            <li>Duplicate payments or invoices</li>
            <li>Inventory tracking issues</li>
          </ul>
        </div>

        {/* Acknowledgment Checkbox */}
        <div className="mb-4">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 w-4 h-4"
            />
            <span className="text-sm text-gray-700">
              I acknowledge that this is a duplicate/similar entry and I want to proceed
              with creating it anyway. I understand the potential risks.
            </span>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onProceed}
            disabled={!acknowledged}
            className={`px-4 py-2 rounded-lg ${
              acknowledged
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Hook for duplicate detection
export function useDuplicateDetection() {
  const [duplicateState, setDuplicateState] = useState<{
    isOpen: boolean;
    exactMatches: DuplicateMatch[];
    fuzzyMatches: DuplicateMatch[];
    onProceedCallback?: () => void;
  }>({
    isOpen: false,
    exactMatches: [],
    fuzzyMatches: [],
  });

  const checkDuplicates = async (
    apiCall: () => Promise<{ hasDuplicates: boolean; exactMatches: DuplicateMatch[]; fuzzyMatches: DuplicateMatch[] }>,
    onProceed: () => void,
  ) => {
    const result = await apiCall();

    if (result.hasDuplicates) {
      setDuplicateState({
        isOpen: true,
        exactMatches: result.exactMatches,
        fuzzyMatches: result.fuzzyMatches,
        onProceedCallback: onProceed,
      });
      return false; // Don't proceed yet
    } else {
      onProceed(); // No duplicates, proceed
      return true;
    }
  };

  const handleProceed = () => {
    setDuplicateState({
      isOpen: false,
      exactMatches: [],
      fuzzyMatches: [],
    });
    duplicateState.onProceedCallback?.();
  };

  const handleCancel = () => {
    setDuplicateState({
      isOpen: false,
      exactMatches: [],
      fuzzyMatches: [],
    });
  };

  return {
    duplicateState,
    checkDuplicates,
    handleProceed,
    handleCancel,
  };
}
