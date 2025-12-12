import React from 'react';
import { FileSystem } from '../types';

interface FileViewerProps {
  files: FileSystem;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export const FileViewer: React.FC<FileViewerProps> = ({ files, selectedFile, onSelectFile }) => {
  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <h3 className="font-bold text-gray-300 uppercase text-xs tracking-wider">Project Files</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {Object.keys(files).length === 0 ? (
          <div className="p-4 text-gray-500 text-sm italic">No files created yet.</div>
        ) : (
          <ul className="py-2">
            {Object.keys(files).map((path) => (
              <li key={path}>
                <button
                  onClick={() => onSelectFile(path)}
                  className={`w-full text-left px-4 py-2 text-sm truncate transition-colors ${
                    selectedFile === path
                      ? 'bg-blue-900/50 text-blue-200 border-l-2 border-blue-500'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};