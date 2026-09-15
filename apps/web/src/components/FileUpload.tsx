'use client';

import { useState } from 'react';

interface FileUploadProps {
  onUploadComplete: (fileUrl: string, fileName: string, fileSize: number) => void;
  acceptedTypes?: string;
  maxSize?: number;
  folder?: string;
}

export default function FileUpload({
  onUploadComplete,
  acceptedTypes = '.pdf,.doc,.docx,.dwg,.dxf,.png,.jpg,.jpeg',
  maxSize = 50,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSize) {
      setError(`File size exceeds ${maxSize}MB limit`);
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? 90 : prev + 10));
      }, 200);

      const reader = new FileReader();
      reader.onload = (event) => {
        clearInterval(progressInterval);
        setProgress(100);
        onUploadComplete(event.target?.result as string, file.name, file.size);
        setTimeout(() => {
          setUploading(false);
          setProgress(0);
        }, 1000);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-3">
      <label
        htmlFor="file-upload"
        className={`flex-1 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors text-center block ${
          uploading ? 'bg-gray-50 cursor-not-allowed' : 'hover:bg-blue-50 hover:border-blue-400'
        } ${error ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
      >
        <input
          id="file-upload"
          type="file"
          accept={acceptedTypes}
          onChange={handleFileChange}
          disabled={uploading}
          className="hidden"
        />
        <div className="flex items-center justify-center gap-2">
          {uploading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-gray-600">Uploading... {progress}%</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-sm text-gray-600">Click to upload file</span>
            </>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">Max {maxSize}MB</p>
      </label>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {uploading && progress > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
