import React, { useEffect, useState } from 'react';
import { FileSystem } from '../types';

interface PreviewFrameProps {
  files: FileSystem;
  isResizing?: boolean;
}

export const PreviewFrame: React.FC<PreviewFrameProps> = ({ files, isResizing = false }) => {
  const [srcDoc, setSrcDoc] = useState('');

  useEffect(() => {
    // Basic bundler simulation
    let html = files['index.html']?.content || '<h1>No index.html found</h1>';
    const css = files['style.css']?.content || '';
    const js = files['script.js']?.content || '';

    // Inject CSS
    if (css) {
      html = html.replace('</head>', `<style>${css}</style></head>`);
    }

    // Inject JS
    if (js) {
      html = html.replace('</body>', `<script>${js}</script></body>`);
    }
    
    // Add default styling for better preview if empty
    if (!files['index.html']) {
        html = `
            <div style="font-family: sans-serif; color: #666; display: flex; align-items: center; justify-content: center; height: 100vh;">
                <div style="text-align: center;">
                    <h2>VoiceFlow Preview</h2>
                    <p>Create an index.html file to start.</p>
                </div>
            </div>
        `;
    }

    setSrcDoc(html);
  }, [files]);

  return (
    <div className="flex-1 bg-white h-full relative">
      {/* Overlay to catch mouse events during resizing */}
      {isResizing && <div className="absolute inset-0 z-50 bg-transparent" />}
      
      <div className="absolute top-0 left-0 bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-br z-10">
        Preview Browser
      </div>
      <iframe
        title="Preview"
        srcDoc={srcDoc}
        className={`w-full h-full border-none ${isResizing ? 'pointer-events-none' : ''}`}
        sandbox="allow-scripts allow-modals"
      />
    </div>
  );
};