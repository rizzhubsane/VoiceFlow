import React from 'react';
import { FileSystem, VirtualFile } from '../types';
import JSZip from 'jszip';

interface FileViewerProps {
  files: FileSystem;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export const FileViewer: React.FC<FileViewerProps> = ({ files, selectedFile, onSelectFile }) => {
  
  const handleDownload = async () => {
    if (Object.keys(files).length === 0) return;
    
    try {
      const zip = new JSZip();
      
      // Add all files to the zip
      Object.values(files).forEach((file: VirtualFile) => {
        // JSZip handles folder structures automatically if path contains slashes
        zip.file(file.path, file.content);
      });
      
      // Generate the zip blob
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      
      // Create a temporary link to trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = 'voiceflow-project.zip';
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to zip files", e);
      alert("Failed to download project files.");
    }
  };

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
        <h3 className="font-bold text-gray-300 uppercase text-xs tracking-wider">Project Files</h3>
        <button 
          onClick={handleDownload}
          className="text-gray-400 hover:text-white hover:bg-gray-700 p-1 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
          title="Download Project as ZIP"
          aria-label="Download Project as ZIP"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {Object.keys(files).length === 0 ? (
          <div className="p-4 text-gray-500 text-sm italic">No files created yet.</div>
        ) : (
          <ul className="py-2">
            {Object.keys(files).sort().map((path) => (
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