import React, { useState, useEffect, useRef, FC, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, GenerateContentResponse, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { marked } from 'marked';

// --- Type definitions for Web Speech API ---
// This is to fix TypeScript errors as these types are not standard in all environments.
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onerror: ((this: SpeechRecognition, ev: Event) => any) | null; // Note: The event is technically SpeechRecognitionError, but Event is safer for broader compatibility.
}

interface SpeechRecognitionStatic {
    new(): SpeechRecognition;
}

interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    readonly [index: number]: SpeechRecognitionResult;
    readonly length: number;
}

interface SpeechRecognitionResult {
    readonly [index: number]: SpeechRecognitionAlternative;
    readonly length: number;
    readonly isFinal: boolean;
}

interface SpeechRecognitionAlternative {
    readonly transcript: string;
}

declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionStatic;
        webkitSpeechRecognition: SpeechRecognitionStatic;
    }
}
// --- End of type definitions ---

type GroundingChunk = {
    web: {
        uri: string;
        title: string;
    };
};

type Message = {
    id: string;
    sender: 'user' | 'ai' | 'system';
    text: string;
    sources?: GroundingChunk[];
    image?: { dataUrl: string; name: string; };
};

type UploadedFile = {
    name: string;
    content: string;
};

type PastedImage = {
    dataUrl: string;
    name: string;
    type: string;
    base64: string;
};

type AppStatus = 'idle' | 'listening' | 'processing';

type Slide = {
    title: string;
    text: string;
    image_prompt: string;
    imageUrl?: string;
};


// --- SVG Icon Components (defined globally) ---
const InfoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    </svg>
);
const ShieldIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
    </svg>
);
const MicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16">
        <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z"/>
        <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0v5zM8 0a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V3a3 3 0 0 0-3-3z"/>
    </svg>
);
const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
        <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5z"/>
    </svg>
);
const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
);
const SpeakerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        <path d="M0 0h24v24H0z" fill="none"/>
    </svg>
);
const SoundWaveIcon = () => (
    <svg className="sound-wave" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm7 1.06L8.06 12 10 13.94V10.06zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        <path d="M0 0h24v24H0z" fill="none"/>
    </svg>
);
const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59-1.69.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
    </svg>
);
const AppIcon = () => (
    <svg className="header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
        <g fill="#FFD700">
            <path transform="rotate(45 256 256)" d="M256 472c-26 0-47-15-47-34 0-19 21-34 47-34s47 15 47 34c0 19-21 34-47 34zm-75-57c-31 0-56-25-56-56s25-56 56-56 56 25 56 56-25 56-56 56zm150 0c-31 0-56-25-56-56s25-56 56-56 56 25 56 56-25 56-56 56zm-87-133h24v-160h-24v160zm-44-160h104v40H200v-40zm32 10v20h40v-20h-40z"/>
            <path transform="rotate(-45 256 256)" d="M256 472c-26 0-47-15-47-34 0-19 21-34 47-34s47 15 47 34c0 19-21 34-47 34zm-75-57c-31 0-56-25-56-56s25-56 56-56 56 25 56 56-25 56-56 56zm150 0c-31 0-56-25-56-56s25-56 56-56 56 25 56 56-25 56-56 56zm-87-133h24v-160h-24v160zm-44-160h104v40H200v-40zm32 10v20h40v-20h-40z"/>
        </g>
    </svg>
);
const KnowledgeBaseIcon = () => (
    <svg className="header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 9v3c0 2.21 3.58 4 8 4s8-1.79 8-4V9c0 2.21-3.58 4-8 4s-8-1.79-8-4zm0 5v3c0 2.21 3.58 4 8 4s8-1.79 8-4v-3c0 2.21-3.58 4-8 4s-8-1.79-8-4z"/>
    </svg>
);
const ArticleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>
);
const LegalIcon = () => (
    <svg className="header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.64,1.36L10.13,2.87L2.87,10.13L1.36,11.64C0.58,12.42 0.58,13.69 1.36,14.46L9.54,22.64C10.31,23.42 11.58,23.42 12.36,22.64L22.64,12.36C23.42,11.58 23.42,10.31 22.64,9.54L14.46,1.36C13.69,0.58 12.42,0.58 11.64,1.36M4,18L10,12L12,14L6,20H4V18Z" />
    </svg>
);
const Spinner = () => <div className="spinner"></div>;
const AttachmentIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
    </svg>
);
const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2-H5z"/>
    </svg>
);
const DeleteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
);
const ScreenShareIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
    </svg>
);
const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
);
const SaveIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>
);
const CancelIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
    </svg>
);
const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-5zm0 16H8V7h11v14z"/>
    </svg>
);
const EyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 13c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
    </svg>
);
const LockIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
    </svg>
);


// --- File Preview Modal Component ---
const FilePreviewModal: FC<{
    file: UploadedFile | null;
    onClose: () => void;
}> = ({ file, onClose }) => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        if (file) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [file, onClose]);

    if (!file) return null;

    return (
        <div className="documents-modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-modal-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-content">
                <div className="modal-header">
                    <h2 id="preview-modal-title">Anteprima: {file.name}</h2>
                    <button onClick={onClose} className="close-modal-button" aria-label="Chiudi Anteprima">&times;</button>
                </div>
                <div className="modal-body preview-body">
                    <pre className="file-content-preview">{file.content}</pre>
                </div>
                <div className="modal-footer">
                    <button className="add-file-button" onClick={onClose}>Chiudi</button>
                </div>
            </div>
        </div>
    );
};

// --- Refactored Sources Modal Component ---
const SourcesModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    files: UploadedFile[];
    onFilesUpdate: (files: UploadedFile[]) => void;
    onAddFilesClick: () => void;
    isProcessing: boolean;
}> = ({ isOpen, onClose, files, onFilesUpdate, onAddFilesClick, isProcessing }) => {
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
    const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
    const [googleSheetUrl, setGoogleSheetUrl] = useState('');
    const [importStatus, setImportStatus] = useState<{ type: 'idle' | 'loading' | 'error' | 'success'; message: string }>({ type: 'idle', message: '' });
    const [previewingFile, setPreviewingFile] = useState<UploadedFile | null>(null);

    // Reset internal state when modal is closed or files change externally
    useEffect(() => {
        if (!isOpen) {
            setSelectedFiles(new Set());
            setConfirmDeleteAll(false);
            setConfirmDeleteSelected(false);
            setGoogleSheetUrl('');
            setImportStatus({ type: 'idle', message: '' });
            setPreviewingFile(null);
        }
    }, [isOpen]);

    useEffect(() => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
    }, [files]);


    const areAllSelected = files.length > 0 && selectedFiles.size === files.length;

    const handleFileSelection = (fileName: string) => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
        setSelectedFiles(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(fileName)) {
                newSelection.delete(fileName);
            } else {
                newSelection.add(fileName);
            }
            return newSelection;
        });
    };

    const handleSelectAll = () => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
        if (areAllSelected) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(files.map(f => f.name)));
        }
    };

    const handleRemoveSelected = () => {
        if (selectedFiles.size === 0) return;
        if (confirmDeleteSelected) {
            onFilesUpdate(files.filter(file => !selectedFiles.has(file.name)));
            setSelectedFiles(new Set());
            setConfirmDeleteSelected(false);
        } else {
            setConfirmDeleteSelected(true);
            setConfirmDeleteAll(false);
        }
    };

    const handleRemoveAll = () => {
        if (files.length === 0) return;
        if (confirmDeleteAll) {
            onFilesUpdate([]);
            setSelectedFiles(new Set());
            setConfirmDeleteAll(false);
        } else {
            setConfirmDeleteAll(true);
            setConfirmDeleteSelected(false);
        }
    };
    
    const handleImportGoogleSheet = async () => {
        setImportStatus({ type: 'loading', message: 'Importazione in corso...' });
        try {
            const match = googleSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (!match || !match[1]) {
                throw new Error('URL del Foglio Google non valido o non riconosciuto.');
            }
            const sheetId = match[1];
    
            const fileName = `google-sheet-${sheetId.substring(0, 12)}.csv`;
            if (files.some(file => file.name === fileName)) {
                throw new Error(`Il file "${fileName}" esiste già.`);
            }
            
            const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
            const response = await fetch(csvUrl);
    
            if (!response.ok) {
                throw new Error('Impossibile accedere al foglio. Assicurati che sia pubblico ("Chiunque abbia il link").');
            }
    
            const csvContent = await response.text();
            if (!csvContent || csvContent.trim().length === 0) {
                throw new Error('Il foglio di calcolo sembra essere vuoto.');
            }
    
            const newFile: UploadedFile = { name: fileName, content: csvContent.trim() };
            onFilesUpdate([...files, newFile]);
            setGoogleSheetUrl('');
            setImportStatus({ type: 'success', message: 'Foglio importato con successo!' });
    
            setTimeout(() => setImportStatus({ type: 'idle', message: '' }), 4000);
    
        } catch (error: any) {
            console.error("Google Sheet import failed:", error);
            setImportStatus({ type: 'error', message: error.message });
        }
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;

    return (
        <div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-content">
                <div className="modal-header">
                    <h2 id="modal-title">Fonti di Conoscenza</h2>
                    <button onClick={onClose} className="close-modal-button" aria-label="Chiudi">&times;</button>
                </div>
                <div className="modal-body">
                    <p className="modal-intro">Questi file costituiscono la base di conoscenza dell'assistente. L'aggiunta o la rimozione di file resetterà la conversazione per applicare il nuovo contesto.</p>
                    <div className="persistence-info">
                        <InfoIcon />
                        <span>Le tue fonti vengono salvate automaticamente nel browser per le sessioni future.</span>
                    </div>
                    <div className="persistence-warning">
                        <strong>Attenzione:</strong> Questo salvaggio dipende dalle impostazioni del tuo browser. I dati potrebbero non persistere se usi la navigazione in incognito, se il browser è impostato per cancellare i dati alla chiusura, o se si supera il limite di archiviazione (solitamente 5-10 MB).
                    </div>
                    <div className="google-sheet-importer">
                        <h4>Importa da Google Sheet</h4>
                        <p className="modal-intro">Incolla il link di un Foglio Google pubblico. Verrà importato come file CSV.</p>
                        <div className="importer-input-group">
                            <input
                                type="text"
                                value={googleSheetUrl}
                                onChange={(e) => {
                                    setGoogleSheetUrl(e.target.value);
                                    if (importStatus.type !== 'idle') setImportStatus({ type: 'idle', message: '' });
                                }}
                                placeholder="https://docs.google.com/spreadsheets/d/..."
                                disabled={importStatus.type === 'loading'}
                                aria-label="URL Foglio Google"
                            />
                            <button
                                onClick={handleImportGoogleSheet}
                                disabled={importStatus.type === 'loading' || !googleSheetUrl.trim()}
                            >
                                {importStatus.type === 'loading' ? <Spinner /> : 'Importa'}
                            </button>
                        </div>
                        {importStatus.message && (
                            <p className={`importer-status ${importStatus.type}`}>
                                {importStatus.message}
                            </p>
                        )}
                    </div>
                    <div className="file-list-container">
                        {files.length > 0 && (
                            <div className="file-list-header">
                                <label className="select-all-label">
                                    <input type="checkbox" checked={areAllSelected} onChange={handleSelectAll} />
                                    <span className="custom-checkbox"></span>
                                    <span>Seleziona Tutto ({selectedFiles.size}/{files.length})</span>
                                </label>
                            </div>
                        )}
                        <ul className="file-list-modal">
                            {files.length === 0 ? (
                                <li className="no-files">Nessuna fonte presente.</li>
                            ) : (
                                files.map(file => (
                                    <li key={file.name} className={selectedFiles.has(file.name) ? 'selected' : ''}>
                                        <label className="file-item-label">
                                            <input type="checkbox" checked={selectedFiles.has(file.name)} onChange={() => handleFileSelection(file.name)} />
                                            <span className="custom-checkbox"></span>
                                            <span className="file-name">{file.name}</span>
                                        </label>
                                        <button onClick={() => setPreviewingFile(file)} className="preview-file-button" aria-label={`Anteprima di ${file.name}`} title="Anteprima">
                                            <EyeIcon />
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="add-file-button" onClick={onAddFilesClick} disabled={isProcessing}>
                        Aggiungi Fonti
                    </button>
                    <div className="delete-actions">
                        {!confirmDeleteSelected ? (
                            <button
                                className="remove-selected-button"
                                onClick={handleRemoveSelected}
                                disabled={isProcessing || selectedFiles.size === 0}
                            >
                                Elimina Selezionate ({selectedFiles.size})
                            </button>
                        ) : (
                            <button
                                className="remove-selected-button confirm"
                                onClick={handleRemoveSelected}
                                disabled={isProcessing}
                            >
                                Conferma Elimina ({selectedFiles.size})
                            </button>
                        )}
                        {!confirmDeleteAll ? (
                             <button
                                className="remove-all-button"
                                onClick={handleRemoveAll}
                                disabled={isProcessing || files.length === 0}
                            >
                                Svuota Tutto
                            </button>
                        ) : (
                             <button
                                className="remove-all-button confirm"
                                onClick={handleRemoveAll}
                                disabled={isProcessing}
                            >
                                Conferma Svuota Tutto
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <FilePreviewModal file={previewingFile} onClose={() => setPreviewingFile(null)} />
        </div>
    );
};

// --- Templates Modal Component ---
const TemplatesModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    templates: UploadedFile[];
    onTemplatesUpdate: (templates: UploadedFile[]) => void;
    onAddTemplatesClick: () => void;
    isProcessing: boolean;
}> = ({ isOpen, onClose, templates, onTemplatesUpdate, onAddTemplatesClick, isProcessing }) => {
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
    const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setSelectedFiles(new Set());
            setConfirmDeleteAll(false);
            setConfirmDeleteSelected(false);
        }
    }, [isOpen]);

    useEffect(() => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
    }, [templates]);

    const areAllSelected = templates.length > 0 && selectedFiles.size === templates.length;

    const handleFileSelection = (fileName: string) => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
        setSelectedFiles(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(fileName)) {
                newSelection.delete(fileName);
            } else {
                newSelection.add(fileName);
            }
            return newSelection;
        });
    };

    const handleSelectAll = () => {
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
        if (areAllSelected) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(templates.map(f => f.name)));
        }
    };

    const handleRemoveSelected = () => {
        if (selectedFiles.size === 0) return;
        if (confirmDeleteSelected) {
            onTemplatesUpdate(templates.filter(file => !selectedFiles.has(file.name)));
            setSelectedFiles(new Set());
            setConfirmDeleteSelected(false);
        } else {
            setConfirmDeleteSelected(true);
            setConfirmDeleteAll(false);
        }
    };

    const handleRemoveAll = () => {
        if (templates.length === 0) return;
        if (confirmDeleteAll) {
            onTemplatesUpdate([]);
            setSelectedFiles(new Set());
            setConfirmDeleteAll(false);
        } else {
            setConfirmDeleteAll(true);
            setConfirmDeleteSelected(false);
        }
    };
    
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;

    return (
        <div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-content">
                <div className="modal-header">
                    <h2 id="modal-title">Modelli di Lettera</h2>
                    <button onClick={onClose} className="close-modal-button" aria-label="Chiudi">&times;</button>
                </div>
                <div className="modal-body">
                    <p className="modal-intro">Questi modelli possono essere usati dall'assistente per formattare le risposte. Per usare un modello, fai riferimento al suo nome esatto nella tua domanda.</p>
                     <div className="persistence-info">
                        <InfoIcon />
                        <span>I tuoi modelli vengono salvati automaticamente nel browser per le sessioni future.</span>
                    </div>
                     <div className="persistence-warning">
                        <strong>Attenzione:</strong> Questo salvaggio dipende dalle impostazioni del tuo browser. I dati potrebbero non persistere se usi la navigazione in incognito, se il browser è impostato per cancellare i dati alla chiusura, o se si supera il limite di archiviazione (solitamente 5-10 MB).
                    </div>
                    <div className="file-list-container">
                        {templates.length > 0 && (
                            <div className="file-list-header">
                                <label className="select-all-label">
                                    <input type="checkbox" checked={areAllSelected} onChange={handleSelectAll} />
                                    <span className="custom-checkbox"></span>
                                    <span>Seleziona Tutto ({selectedFiles.size}/{templates.length})</span>
                                </label>
                            </div>
                        )}
                        <ul className="file-list-modal">
                            {templates.length === 0 ? (
                                <li className="no-files">Nessun modello presente.</li>
                            ) : (
                                templates.map(file => (
                                    <li key={file.name} className={selectedFiles.has(file.name) ? 'selected' : ''}>
                                        <label className="file-item-label">
                                            <input type="checkbox" checked={selectedFiles.has(file.name)} onChange={() => handleFileSelection(file.name)} />
                                            <span className="custom-checkbox"></span>
                                            <span className="file-name">{file.name}</span>
                                        </label>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="add-file-button" onClick={onAddTemplatesClick} disabled={isProcessing}>
                        Aggiungi Modelli
                    </button>
                    <div className="delete-actions">
                        {!confirmDeleteSelected ? (
                            <button
                                className="remove-selected-button"
                                onClick={handleRemoveSelected}
                                disabled={isProcessing || selectedFiles.size === 0}
                            >
                                Elimina Selezionati ({selectedFiles.size})
                            </button>
                        ) : (
                            <button
                                className="remove-selected-button confirm"
                                onClick={handleRemoveSelected}
                                disabled={isProcessing}
                            >
                                Conferma Elimina ({selectedFiles.size})
                            </button>
                        )}
                        {!confirmDeleteAll ? (
                             <button
                                className="remove-all-button"
                                onClick={handleRemoveAll}
                                disabled={isProcessing || templates.length === 0}
                            >
                                Svuota Tutto
                            </button>
                        ) : (
                             <button
                                className="remove-all-button confirm"
                                onClick={handleRemoveAll}
                                disabled={isProcessing}
                            >
                                Conferma Svuota Tutto
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Presentation Mode Components ---
const PresentationLoadingModal: FC<{ message: string }> = ({ message }) => {
    if (!message) return null;
    return (
        <div className="presentation-loader-overlay">
            <div className="presentation-loader-content">
                <Spinner />
                <p>{message}</p>
            </div>
        </div>
    );
};

const PresentationViewer: FC<{
    slides: Slide[];
    currentSlide: number;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    onSave: () => void;
    isSaving: boolean;
}> = ({ slides, currentSlide, onClose, onNext, onPrev, onSave, isSaving }) => {
    const slide = slides[currentSlide];

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowRight' && currentSlide < slides.length - 1) onNext();
            if (event.key === 'ArrowLeft' && currentSlide > 0) onPrev();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev, currentSlide, slides.length]);
    
    if (!slide) return null;

    return (
        <div className="presentation-viewer-overlay" role="dialog" aria-modal="true">
            <div className="presentation-viewer-content">
                <button onClick={onClose} className="close-presentation-btn" aria-label="Chiudi presentazione">&times;</button>
                <div className="slide-header">
                    <h2>{slide.title}</h2>
                </div>
                <div className="slide-body">
                    <div className="slide-image-container">
                        {!slide.imageUrl ? (
                            <div className="image-placeholder"><Spinner /></div>
                        ) : slide.imageUrl === 'ERROR' ? (
                            <div className="image-placeholder error">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                                <span>Errore generazione immagine</span>
                            </div>
                        ) : (
                            <img src={slide.imageUrl} alt={slide.title} />
                        )}
                    </div>
                    <div className="slide-text">
                        <ReactMarkdown>{slide.text}</ReactMarkdown>
                    </div>
                </div>
                <div className="slide-footer">
                    <button onClick={onPrev} disabled={currentSlide === 0 || isSaving}>Indietro</button>
                    <div className="footer-center">
                        <span>Diapositiva {currentSlide + 1} di {slides.length}</span>
                        <button onClick={onSave} disabled={isSaving} className="save-presentation-btn">
                            {isSaving ? 'Salvataggio in corso...' : 'Salva come PDF'}
                        </button>
                    </div>
                    <button onClick={onNext} disabled={currentSlide === slides.length - 1 || isSaving}>Avanti</button>
                </div>
            </div>
        </div>
    );
};

// --- Component for Off-screen PDF Rendering ---
const PdfSlideView: FC<{ slide: Slide }> = ({ slide }) => {
    return (
        <div className="pdf-slide-render-container">
            <div className="slide-header">
                <h2>{slide.title}</h2>
            </div>
            <div className="slide-body">
                <div className="slide-image-container">
                    {slide.imageUrl && slide.imageUrl !== 'ERROR' ? (
                        <img src={slide.imageUrl} alt={slide.title} />
                    ) : (
                        <div className="image-placeholder">Immagine non disponibile</div>
                    )}
                </div>
                <div className="slide-text">
                    <ReactMarkdown>{slide.text}</ReactMarkdown>
                </div>
            </div>
            <div className="pdf-slide-footer">
                <span>Consulente SCV - Conformità Vaticana</span>
            </div>
        </div>
    );
};

// --- Main App Component ---
// --- NUOVO E SICURO AppContainer ---
const AppContainer: FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [isAccepted, setIsAccepted] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const passwordInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        passwordInputRef.current?.focus();
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!isAccepted) {
            setError('È necessario accettare le condizioni per procedere.');
            return;
        }

        setIsLoading(true);

        try {
            const response = await fetch('/.netlify/functions/check-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });

            if (response.ok) {
                setIsAuthenticated(true);
            } else {
                setError('Password non valida.');
                setPassword(''); // Resetta il campo password
                passwordInputRef.current?.focus(); // Rimette il focus sull'input
            }
        } catch (err) {
            setError('Errore di comunicazione con il server. Riprova.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="lock-screen-container">
                <div className="lock-screen-box" style={{maxWidth: '700px'}}>
                    <h1>Accesso Riservato</h1>
                    
                    <div className="disclaimer" style={{textAlign: 'left', border: '1px solid #ddd', padding: '15px', borderRadius: '8px', maxHeight: '150px', overflowY: 'auto', marginBottom: '20px', fontSize: '12px', color: '#606770', lineHeight: '1.5'}}>
                        <h2 style={{marginTop: '0', fontSize: '16px', color: '#333'}}>Avvertenze d'Uso e Limitazione di Responsabilità</h2>
                        <h4 style={{marginTop: '15px', marginBottom: '5px', fontSize: '14px', color: '#1c1e21'}}>Scopo dello Strumento</h4>
                        <p>"Consulente SCV" è uno strumento di supporto decisionale basato su intelligenza artificiale, progettato per assistere i professionisti in ambito legale e contabile.</p>
                        <h4 style={{marginTop: '15px', marginBottom: '5px', fontSize: '14px', color: '#1c1e21'}}>Natura Informativa e Non Vincolante</h4>
                        <p>Le informazioni, le analisi e gli output generati da questa applicazione sono forniti a solo scopo informativo e preliminare. <strong>Essi non costituiscono in alcun modo un parere legale, finanziario, contabile o professionale.</strong></p>
                        <h4 style={{marginTop: '15px', marginBottom: '5px', fontSize: '14px', color: '#1c1e21'}}>Non Sostituisce il Parere di un Esperto</h4>
                        <p>L'applicazione non sostituisce il giudizio, la competenza e la verifica di un professionista qualificato e legalmente abilitato.</p>
                        <h4 style={{marginTop: '15px', marginBottom: '5px', fontSize: '14px', color: '#1c1e21'}}>Accuratezza delle Informazioni</h4>
                        <p>L'intelligenza artificiale può commettere errori. <strong>L'utente è l'unico responsabile della verifica e della validazione di tutte le informazioni prima del loro utilizzo.</strong></p>
                        <h4 style={{marginTop: '15px', marginBottom: '5px', fontSize: '14px', color: '#1c1e21'}}>Limitazione di Responsabilità</h4>
                        <p>In nessun caso lo sviluppatore o il fornitore dell'applicazione potranno essere ritenuti responsabili per qualsiasi danno derivante dall'uso di questo strumento.</p>
                    </div>

                    <form onSubmit={handleLogin}>
                        <div className="acceptance" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', fontSize: '14px'}}>
                            <input 
                                type="checkbox" 
                                id="accept-checkbox" 
                                checked={isAccepted}
                                onChange={(e) => setIsAccepted(e.target.checked)}
                                style={{marginRight: '10px'}}
                            />
                            <label htmlFor="accept-checkbox">Dichiaro di aver letto, compreso e accettato le Avvertenze d'Uso.</label>
                        </div>
                        <input
                            ref={passwordInputRef}
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Inserisci la password di accesso"
                            aria-label="Password"
                            disabled={isLoading}
                        />
                        <button type="submit" disabled={isLoading}>
                            {isLoading ? 'Verifica in corso...' : 'Accedi'}
                        </button>
                    </form>
                    {error && <p className="lock-screen-error">{error}</p>}
                </div>
            </div>
        );
    }

    return <App />;
};

const App: FC = () => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [chatHistory, setChatHistory] = useState<Message[]>([{ id: 'system-init', sender: 'system', text: 'Inizializzazione assistente...' }]);
    const [chat, setChat] = useState<Chat | null>(null);
    const [inputText, setInputText] = useState<string>('');
    const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
    const [isAiInitialized, setIsAiInitialized] = useState<boolean>(false);
    const [isApiLocked, setIsApiLocked] = useState<boolean>(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const sourcesFileInputRef = useRef<HTMLInputElement>(null);
    const templatesFileInputRef = useRef<HTMLInputElement>(null);
    const examineFileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const handleUserMessageRef = useRef(handleUserMessage);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

    const [systemInstruction, setSystemInstruction] = useState<string>('');


    // States for speech synthesis settings
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(localStorage.getItem('selectedVoiceURI'));
    const [speechRate, setSpeechRate] = useState<number>(() => parseFloat(localStorage.getItem('speechRate') || '1'));
    const [showSettings, setShowSettings] = useState(false);
    const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(false);
    
    // State for editing messages - Redesigned for stability
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editText, setEditText] = useState<string>('');

    // States for file context
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() => {
        try {
            const savedFiles = localStorage.getItem('custodyAssistantFiles');
            return savedFiles ? JSON.parse(savedFiles) : [];
        } catch (error) {
            console.error("Failed to parse saved files from localStorage:", error);
            return [];
        }
    });
    const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false);

    // State for templates
    const [uploadedTemplates, setUploadedTemplates] = useState<UploadedFile[]>(() => {
        try {
            const savedTemplates = localStorage.getItem('custodyAssistantTemplates');
            return savedTemplates ? JSON.parse(savedTemplates) : [];
        } catch (error) {
            console.error("Failed to parse saved templates from localStorage:", error);
            return [];
        }
    });
    const [showTemplatesModal, setShowTemplatesModal] = useState<boolean>(false);
    
    // State for About & Privacy Modals
    const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
    const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
    const [shareBtnText, setShareBtnText] = useState<string>('Condividi App');
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    
    // State for single file examination
    const [examineFile, setExamineFile] = useState<{ name: string; content: string } | null>(null);
    const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
    
    // State for screen sharing
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    
    // State for Presentation Mode
    const [presentationSlides, setPresentationSlides] = useState<Slide[]>([]);
    const [showPresentation, setShowPresentation] = useState<boolean>(false);
    const [currentSlide, setCurrentSlide] = useState<number>(0);
    const [presentationStatusMessage, setPresentationStatusMessage] = useState<string>('');
    const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
    
    // States for PDF Rendering
    const [pdfRenderSlide, setPdfRenderSlide] = useState<Slide | null>(null);
    const pdfContainerRef = useRef<HTMLDivElement>(null);


    // Effect for ONE-TIME app initialization (API client)
    useEffect(() => {
        // Configure the PDF.js worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

const apiKey = import.meta.env.VITE_API_KEY;

if (!apiKey) {
    setChatHistory([{ id: 'system-error-apikey', sender: 'system', text: "Benvenuto! La chiave API di Google Gemini non è stata trovata. Assicurati che sia configurata correttamente nelle variabili d'ambiente di Netlify con il nome VITE_API_KEY." }]);
    setIsAiInitialized(false);
    return;
}

try {
    aiRef.current = new GoogleGenAI({ apiKey: apiKey });
    setIsAiInitialized(true);
} catch (error) {
    console.error("Errore durante l'inizializzazione di Gemini:", error);
    setChatHistory([{ id: 'system-error-gemini', sender: 'system', text: "Impossibile inizializzare l'assistente AI. La chiave API potrebbe non essere valida. Controlla la Google Cloud Console e ricarica la pagina." }]);
    setIsAiInitialized(false);
}
        }

        
        
        return () => {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    // Effect for Microphone Initialization
    useEffect(() => {
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            setChatHistory(prev => [...prev, { id: 'system-error-sr', sender: 'system', text: "Errore: Il tuo browser non supporta il riconoscimento vocale. Prova con Chrome." }]);
            return;
        }

        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = false;
        recognition.lang = 'it-IT';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;

        const handleResult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            const transcript = finalTranscript.trim();
            if (transcript) {
                // If screen sharing is active, just fill the input text.
                if (screenStream) {
                    setInputText(transcript);
                } else if (handleUserMessageRef.current) {
                    // Otherwise, send the message directly.
                    handleUserMessageRef.current(transcript);
                }
            }
        };

        const handleEnd = () => {
            setStatus(currentStatus => (currentStatus === 'listening' ? 'idle' : currentStatus));
        };

        const handleError = (event: Event & { error?: string }) => {
            console.error('Speech recognition error:', event.error || 'Unknown error');
            let errorMessage = "Si è verificato un errore con il riconoscimento vocale.";
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                errorMessage = "L'accesso al microfono è stato negato. Controlla le autorizzazioni del browser per questo sito.";
            } else if (event.error === 'no-speech') {
                errorMessage = "Nessun discorso rilevato. Riprova.";
            }
            
            setChatHistory(prev => [...prev, { id: `system-sr-err-${Date.now()}`, sender: 'system', text: errorMessage }]);
            setStatus(currentStatus => (currentStatus === 'listening' ? 'idle' : currentStatus));
        };

        recognition.addEventListener('result', handleResult);
        recognition.addEventListener('end', handleEnd);
        recognition.addEventListener('error', handleError as EventListener);

        return () => {
            if (recognition) {
                recognition.removeEventListener('result', handleResult);
                recognition.removeEventListener('end', handleEnd);
                recognition.removeEventListener('error', handleError as EventListener);
                recognition.stop();
            }
        };
    }, [screenStream]); // Re-run effect if screenStream changes to update handleResult logic
    
    // Effect to initialize or re-initialize the chat session when AI is ready or files/settings change
    useEffect(() => {
        if (!isAiInitialized) return;

        const initializeChatSession = async () => {
            if (!aiRef.current) return;
            
            setStatus('processing');
            setChatHistory([{id: 'system-init', sender: 'system', text: 'Sto aggiornando il contesto...'}]);

            const baseSystemInstruction = `Sei un assistente AI avanzato specializzato in "Vatican Legal and Financial Compliance". La tua missione è fornire analisi esperte, strategie operative e supporto decisionale basato su un corpus di dati specifico dello Stato della Città del Vaticano.

La tua base di conoscenza include:
1.  **Corpus normativo:** Tutte le leggi, i regolamenti e i Motu Proprio che disciplinano l'ordinamento vaticano, con particolare attenzione a quelli relativi all'economia, alla finanza, agli appalti e alla trasparenza.
2.  **Principi contabili:** La normativa specifica che regola la redazione dei bilanci, le procedure di audit e i principi di gestione finanziaria vaticani.
3.  **Case law e prassi applicativa:** Analisi dei precedenti e delle decisioni degli organi di controllo e giudiziari vaticani in materia economica.

Le tue competenze specialistiche includono:
1.  **Conoscenza approfondita del diritto canonico e del diritto civile vaticano:** Comprendi la gerarchia delle fonti e la prevalenza del diritto canonico.
2.  **Compliance normativa:** Sei in grado di analizzare documenti e transazioni per verificarne la conformità alle leggi vaticane, in particolare quelle relative alla prevenzione del riciclaggio di denaro (AML) e al contrasto del finanziamento del terrorismo (CTF).
3.  **Analisi finanziaria e contabile:** Hai l'abilità di interpretare bilanci, flussi di cassa e rendiconti economici secondo i principi contabili vaticani.
4.  **Consulenza e due diligence:** Fornisci supporto per la redazione di contratti, la valutazione di progetti e l'analisi di rischi finanziari nel contesto vaticano.
5.  **Rendicontazione e reporting:** Sei capace di generare report dettagliati e documenti di rendicontazione conformi alle normative vaticane per gli organi di controllo come la Segreteria per l'Economia e il Consiglio per l'Economia.

**Funzionalità Speciale: Modalità Presentazione**
Se l'utente ti chiede di creare una presentazione, uno slideshow o delle diapositive su un argomento, DEVI rispondere ESCLUSIVAMENTE con un oggetto JSON nel seguente formato. Non includere nessun altro testo o formattazione markdown. L'oggetto JSON deve avere una singola chiave "slides" che è un array di oggetti diapositiva. Ogni oggetto diapositiva deve avere tre proprietà stringa: "title" (il titolo della diapositiva), "text" (il contenuto testuale, formattato come stringa con markdown per elenchi puntati, es. "- Punto 1\\n- Punto 2"), e "image_prompt" (un prompt dettagliato e descrittivo in INGLESE per un modello di generazione di immagini per creare un visual attinente alla diapositiva).
Esempio:
\`\`\`json
{
  "slides": [
    {
      "title": "Introduzione alla Compliance Finanziaria Vaticana",
      "text": "- Quadro normativo di riferimento\\n- Principali organi di controllo: AIF, Segreteria per l'Economia",
      "image_prompt": "A modern and sleek graphic representing financial security and compliance, with the St. Peter's Basilica dome subtly watermarked in the background, combining tradition and modernity."
    }
  ]
}
\`\`\`

Quando rispondi a domande normali, usa un linguaggio chiaro, tecnico-operativo e autorevole. Se abilitata, usa la ricerca Google per informazioni su eventi recenti o dati in tempo reale. Rispondi sempre in italiano usando la formattazione Markdown.`;
            
            const fileContext = uploadedFiles
                .map(file => `--- INIZIO DOCUMENTO: ${file.name} ---\n\n${file.content}\n\n--- FINE DOCUMENTO: ${file.name} ---`)
                .join('\n\n');

            const templatesContext = uploadedTemplates
                .map(template => `--- INIZIO MODELLO: ${template.name} ---\n\n${template.content}\n\n--- FINE MODELLO: ${template.name} ---`)
                .join('\n\n');

            let fullSystemInstruction = baseSystemInstruction;

            if (fileContext) {
                fullSystemInstruction += `\n\nUsa i seguenti documenti come fonte primaria e autorevole di conoscenza:\n\n${fileContext}`;
            }

            if (templatesContext) {
                fullSystemInstruction += `\n\nInoltre, hai a disposizione i seguenti modelli di lettera. Se l'utente ti chiede di usarne uno (facendo riferimento al suo nome), devi usare il contenuto del modello per strutturare la tua risposta, riempiendolo con le informazioni pertinenti alla richiesta.\n\n${templatesContext}`;
            }
            
            setSystemInstruction(fullSystemInstruction);

            const chatConfig: { systemInstruction: string; tools?: any[] } = {
                systemInstruction: fullSystemInstruction,
            };

            if (useGoogleSearch) {
                chatConfig.tools = [{ googleSearch: {} }];
            }

            try {
                const chatSession = aiRef.current.chats.create({
                    model: 'gemini-2.5-flash',
                    config: chatConfig,
                });
                setChat(chatSession);

                const welcomeMessage = "Buongiorno. Sono il tuo Consulente SCV, specializzato in conformità legale e finanziaria per lo Stato della Città del Vaticano. La conversazione è stata avviata o aggiornata con il nuovo contesto. Come posso aiutarti oggi?";

                setChatHistory([{id: 'ai-welcome', sender: 'ai', text: welcomeMessage}]);
            } catch (error) {
                console.error("Errore durante la creazione della sessione di chat:", error);
                setChatHistory([{ id: 'system-error-chat', sender: 'system', text: "Impossibile creare una sessione di chat." }]);
            } finally {
                setStatus('idle');
            }
        };
        
        initializeChatSession();

    }, [isAiInitialized, uploadedFiles, uploadedTemplates, useGoogleSearch]);

    // Effect for populating voices
    useEffect(() => {
        const populateVoiceList = () => {
            const availableVoices = window.speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('it'));
            setVoices(availableVoices);
            if (!selectedVoiceURI && availableVoices.length > 0) {
                setSelectedVoiceURI(availableVoices[0].voiceURI);
            }
        };

        populateVoiceList();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = populateVoiceList;
        }
    }, [selectedVoiceURI]);
    
    // Effect for saving settings to localStorage
    useEffect(() => {
        if(selectedVoiceURI) localStorage.setItem('selectedVoiceURI', selectedVoiceURI);
        localStorage.setItem('speechRate', speechRate.toString());
    }, [selectedVoiceURI, speechRate]);
    
    // Effect for persisting files to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('custodyAssistantFiles', JSON.stringify(uploadedFiles));
        } catch (error) {
            console.error("Failed to save files to localStorage:", error);
            const storageErrorMsg: Message = {
                id: `system-storage-err-${Date.now()}`,
                sender: 'system',
                text: "Attenzione: non è stato possibile salvare le fonti di conoscenza nel browser. Potrebbero andare perse alla chiusura della pagina. Questo accade solitamente quando si supera il limite di archiviazione del browser (circa 5-10MB). Prova a rimuovere alcuni file."
            };
            setChatHistory(prev => [...prev, storageErrorMsg]);
        }
    }, [uploadedFiles]);

    // Effect for persisting templates to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('custodyAssistantTemplates', JSON.stringify(uploadedTemplates));
        } catch (error) {
            console.error("Failed to save templates to localStorage:", error);
            const storageErrorMsg: Message = {
                id: `system-storage-err-templates-${Date.now()}`,
                sender: 'system',
                text: "Attenzione: non è stato possibile salvare i modelli nel browser. Potrebbero andare persi alla chiusura della pagina. Questo accade solitamente quando si supera il limite di archiviazione del browser (circa 5-10MB). Prova a rimuovere alcuni modelli."
            };
            setChatHistory(prev => [...prev, storageErrorMsg]);
        }
    }, [uploadedTemplates]);

    // Effect for auto-scrolling chat
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    // Effect for auto-resizing textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputText]);
    
    // Effect for screen share stream cleanup
    useEffect(() => {
        return () => {
            if (screenStream) {
                screenStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [screenStream]);
    
    const handleSourcesFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const processingMsg: Message = { id: `system-proc-${Date.now()}`, sender: 'system', text: `Elaborazione di ${files.length === 1 ? '1 file' : `${files.length} file`} per le fonti...` };
        setChatHistory(prev => [...prev, processingMsg]);

        const newFilesPromises = Array.from(files).map(file => {
            return new Promise<UploadedFile>((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = async (e) => {
                    try {
                        const arrayBuffer = e.target?.result as ArrayBuffer;
                        if (!arrayBuffer) throw new Error("Impossibile leggere il file.");
                        const content = await parseFileContent(file, arrayBuffer);
                        resolve({ name: file.name, content: content.trim() });
                    } catch (error) {
                        console.error('Error parsing file:', error);
                        reject(error);
                    }
                };

                reader.onerror = () => reject(new Error(`Errore di lettura del file: ${file.name}`));
                reader.readAsArrayBuffer(file);
            });
        });

        Promise.all(newFilesPromises)
            .then(newFiles => {
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                setUploadedFiles(prev => {
                    const existingFileNames = new Set(prev.map(f => f.name));
                    const filteredNewFiles = newFiles.filter(nf => !existingFileNames.has(nf.name));
                    return [...prev, ...filteredNewFiles];
                });
            })
            .catch(error => {
                console.error("Error reading files:", error);
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                const errorMsg: Message = { id: `system-err-${Date.now()}`, sender: 'system', text: error.message };
                setChatHistory(prev => [...prev, errorMsg]);
            })
            .finally(() => {
                if (event.target) event.target.value = '';
            });
    };

    const handleTemplatesFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const processingMsg: Message = { id: `system-proc-templates-${Date.now()}`, sender: 'system', text: `Elaborazione di ${files.length === 1 ? '1 modello' : `${files.length} modelli`}...` };
        setChatHistory(prev => [...prev, processingMsg]);

        const newFilesPromises = Array.from(files).map(file => {
            return new Promise<UploadedFile>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const arrayBuffer = e.target?.result as ArrayBuffer;
                        if (!arrayBuffer) throw new Error("Impossibile leggere il file.");
                        const content = await parseFileContent(file, arrayBuffer);
                        resolve({ name: file.name, content: content.trim() });
                    } catch (error) {
                        console.error('Error parsing file:', error);
                        reject(error);
                    }
                };
                reader.onerror = () => reject(new Error(`Errore di lettura del file: ${file.name}`));
                reader.readAsArrayBuffer(file);
            });
        });

        Promise.all(newFilesPromises)
            .then(newFiles => {
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                setUploadedTemplates(prev => {
                    const existingFileNames = new Set(prev.map(f => f.name));
                    const filteredNewFiles = newFiles.filter(nf => !existingFileNames.has(nf.name));
                    return [...prev, ...filteredNewFiles];
                });
            })
            .catch(error => {
                console.error("Error reading files:", error);
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                const errorMsg: Message = { id: `system-err-templates-${Date.now()}`, sender: 'system', text: error.message };
                setChatHistory(prev => [...prev, errorMsg]);
            })
            .finally(() => {
                if (event.target) event.target.value = '';
            });
    };

    const handleExamineFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset any previously staged file.
        if (examineFile) setExamineFile(null);
        if (pastedImage) setPastedImage(null);


        const processingMsg: Message = { id: `system-proc-${Date.now()}`, sender: 'system', text: `Sto caricando il documento: ${file.name}...` };
        setChatHistory(prev => [...prev, processingMsg]);
        
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target?.result as ArrayBuffer;
                if (!arrayBuffer) throw new Error("Impossibile leggere il file.");

                const content = await parseFileContent(file, arrayBuffer);
                
                // Set the file to be examined in state.
                setExamineFile({ name: file.name, content });
                
                // Update chat with a confirmation message.
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                const readyMsg: Message = { id: `system-ready-${Date.now()}`, sender: 'system', text: `File "${file.name}" pronto per l'analisi. Ora scrivi la tua domanda relativa a questo documento.` };
                setChatHistory(prev => [...prev, readyMsg]);

            } catch (error: any) {
                console.error("Error processing file for examination:", error);
                setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
                const errorMsg: Message = { id: `system-err-${Date.now()}`, sender: 'system', text: error.message };
                setChatHistory(prev => [...prev, errorMsg]);
            } finally {
                 if (event.target) event.target.value = '';
            }
        };

        reader.onerror = () => {
             setChatHistory(prev => prev.filter(m => m.id !== processingMsg.id));
             const errorMsg: Message = { id: `system-err-${Date.now()}`, sender: 'system', text: `Errore di lettura del file: ${file.name}` };
             setChatHistory(prev => [...prev, errorMsg]);
        };

        reader.readAsArrayBuffer(file);
    };
    
    const clearExamineFile = () => {
        setExamineFile(null);
        setChatHistory(prev => prev.filter(m => !m.id.startsWith('system-ready-')));
    };

    const parseFileContent = async (file: File, arrayBuffer: ArrayBuffer): Promise<string> => {
        let content = '';
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.pdf')) {
            const data = new Uint8Array(arrayBuffer);
            const pdf = await pdfjsLib.getDocument({ data }).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                fullText += pageText + '\n\n';
            }
            content = fullText;
        } else if (fileName.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ arrayBuffer });
            content = result.value;
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
            let fullText = '';
            workbook.SheetNames.forEach(sheetName => {
                fullText += `--- INIZIO FOGLIO: ${sheetName} ---\n`;
                const worksheet = workbook.Sheets[sheetName];
                const csvData = XLSX.utils.sheet_to_csv(worksheet);
                fullText += csvData + `\n--- FINE FOGLIO: ${sheetName} ---\n\n`;
            });
            content = fullText;
        } else { // Fallback for text-based files
            const textDecoder = new TextDecoder('utf-8');
            content = textDecoder.decode(arrayBuffer);
        }
        
        if (!content || content.trim().length === 0) {
             throw new Error(`Il documento "${file.name}" è vuoto o il testo non ha potuto essere estratto.`);
        }
        return content;
    };

    const handleSpeak = (text: string, messageId: string) => {
        if (!('speechSynthesis' in window)) {
            alert("Il tuo browser non supporta la sintesi vocale.");
            return;
        }

        if (window.speechSynthesis.speaking && speakingMessageId === messageId) {
            window.speechSynthesis.cancel();
            setSpeakingMessageId(null);
            return;
        }

        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }

        const cleanText = text.replace(/[*#_`~]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        
        const selectedVoice = voices.find(voice => voice.voiceURI === selectedVoiceURI);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        
        utterance.rate = speechRate;
        utterance.lang = 'it-IT';
        utterance.onstart = () => setSpeakingMessageId(messageId);
        utterance.onend = () => setSpeakingMessageId(null);
        utterance.onerror = () => setSpeakingMessageId(null);
        window.speechSynthesis.speak(utterance);
    };
    
    const handleDeleteMessage = (messageId: string) => {
        setChatHistory(prev => prev.filter(msg => msg.id !== messageId));
    };
    
    const handleEditMessage = (message: Message) => {
        // Redesigned: No more DOM manipulation. Just set state to trigger the new overlay rendering logic.
        setEditingMessageId(message.id);
        setEditText(message.text);
    };

    const handleSaveEdit = (messageId: string) => {
        setChatHistory(prev =>
            prev.map(msg =>
                msg.id === messageId ? { ...msg, text: editText } : msg
            )
        );
        setEditingMessageId(null);
        setEditText('');
    };

    const handleCancelEdit = () => {
        setEditingMessageId(null);
        setEditText('');
    };

    const handleDownload = async (markdownText: string) => {
        try {
            const htmlContent = await marked.parse(markdownText);
            const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' "+
                "xmlns:w='urn:schemas-microsoft-com:office:word' "+
                "xmlns='http://www.w3.org/TR/REC-html40'>"+
                "<head><meta charset='utf-8'><title>Risposta Consulente SCV</title></head><body>";
            const footer = "</body></html>";
            const sourceHTML = header + htmlContent + footer;

            const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
            const fileDownload = document.createElement("a");
            document.body.appendChild(fileDownload);
            fileDownload.href = source;
            fileDownload.download = 'risposta_consulente_scv.doc';
            fileDownload.click();
            document.body.removeChild(fileDownload);
        } catch (error) {
            console.error("Error creating document for download:", error);
            const errorMsg: Message = { id: `system-download-err-${Date.now()}`, sender: 'system', text: "Impossibile creare il documento per il download." };
            setChatHistory(prev => [...prev, errorMsg]);
        }
    };

    const handleCopy = (text: string, messageId: string) => {
        // WhatsApp interprets ***word*** incorrectly in lists. 
        // We clean it to *word* for bold, which is what users usually want.
        const cleanedText = text.replace(/\*\*\*(.*?)\*\*\*/g, '*$1*');

        navigator.clipboard.writeText(cleanedText).then(() => {
            setCopiedMessageId(messageId);
            setTimeout(() => {
                setCopiedMessageId(null);
            }, 2000); // Reset after 2 seconds
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    };
    
    const captureScreenFrame = (): Promise<PastedImage> => {
        return new Promise((resolve, reject) => {
            if (!videoRef.current || videoRef.current.readyState < 2) { // HAVE_CURRENT_DATA or more
                return reject(new Error("L'elemento video non è pronto per la cattura."));
            }
            
            const video = videoRef.current;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
                return reject(new Error("Impossibile ottenere il contesto del canvas."));
            }

            try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/png');
                if (!dataUrl || dataUrl === 'data:,') {
                    return reject(new Error("Canvas vuoto, impossibile generare l'immagine."));
                }
                const base64 = dataUrl.split(',')[1];
                resolve({
                    dataUrl,
                    base64,
                    type: 'image/png',
                    name: `screenshot-${Date.now()}.png`
                });
            } catch (error) {
                console.error("Errore durante la cattura dal canvas:", error);
                reject(error);
            }
        });
    };

    const handleToggleScreenShare = async () => {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            setScreenStream(null);
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        } else {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: { mediaSource: "screen" } as any,
                });

                if (examineFile) clearExamineFile();
                if (pastedImage) clearPastedImage();

                const videoTrack = stream.getVideoTracks()[0];
                videoTrack.onended = () => {
                    setScreenStream(null);
                    if (videoRef.current) {
                        videoRef.current.srcObject = null;
                    }
                };

                setScreenStream(stream);
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play().catch(e => console.warn("La riproduzione del video per la cattura è fallita:", e));
                }

            } catch (err: any) {
                // If the user denies permission, 'NotAllowedError' is thrown.
                // This is an expected user choice, not a technical error, so we handle it silently
                // by doing nothing and not logging it as an error.
                if (err.name === 'NotAllowedError') {
                    return; // Silently exit the function.
                }

                // For any other unexpected errors, log them and inform the user in the chat.
                console.error("Errore imprevisto nell'avvio della condivisione schermo:", err);
                const errorMessage = "Impossibile avviare la condivisione dello schermo a causa di un errore tecnico.";
                setChatHistory(prev => [...prev, { id: `system-screenshare-err-${Date.now()}`, sender: 'system', text: errorMessage }]);
            }
        }
    };

    const generatePresentation = async (slidesContent: Slide[]) => {
        if (!aiRef.current) return;
    
        setPresentationStatusMessage(`Generazione del testo completata. Inizio a creare ${slidesContent.length} immagini...`);
        setPresentationSlides(slidesContent); // Show placeholders immediately
    
        const slidesWithImages: Slide[] = [];
        let slideNumber = 1;
        let errorCount = 0;
        for (const slide of slidesContent) {
            try {
                setPresentationStatusMessage(`Sto generando l'immagine per la diapositiva ${slideNumber} di ${slidesContent.length}...`);
    
                const imageResponse = await aiRef.current.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: slide.image_prompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '16:9'
                    },
                });
    
                const base64Image = imageResponse.generatedImages[0].image.imageBytes;
                const imageUrl = `data:image/jpeg;base64,${base64Image}`;
    
                const newSlide = { ...slide, imageUrl };
                slidesWithImages.push(newSlide);
                setPresentationSlides([...slidesWithImages, ...slidesContent.slice(slideNumber)]);
    
            } catch (error) {
                console.error(`Image generation failed for slide ${slideNumber}:`, error);
                errorCount++;
                const errorSlide = { ...slide, imageUrl: 'ERROR' }; // Indicate error
                slidesWithImages.push(errorSlide);
                setPresentationSlides([...slidesWithImages, ...slidesContent.slice(slideNumber)]);
            }
            slideNumber++;
        }
    
        if (errorCount > 0) {
            const errorText = errorCount === 1
                ? "Presentazione creata, ma si è verificato un errore durante la generazione di 1 immagine. Potrebbe essere un problema temporaneo del servizio."
                : `Presentazione creata, ma si è verificato un errore durante la generazione di ${errorCount} su ${slidesContent.length} immagini. Potrebbe essere un problema temporaneo del servizio.`;
    
            const errorMessage: Message = {
                id: `system-img-gen-err-${Date.now()}`,
                sender: 'system',
                text: errorText
            };
            setChatHistory(prev => [...prev, errorMessage]);
        }
    
        setPresentationStatusMessage('');
        setCurrentSlide(0);
        setShowPresentation(true);
    };
    
    const handleSavePresentation = async () => {
        if (isSavingPdf || presentationSlides.length === 0 || !pdfContainerRef.current) return;
        setIsSavingPdf(true);
    
        const { default: jsPDF } = await import('jspdf');
        const { default: html2canvas } = await import('html2canvas');
    
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'px',
            format: 'a4'
        });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
    
        for (const [index, slide] of presentationSlides.entries()) {
            setPdfRenderSlide(slide);
            
            // Allow React to render the slide in the off-screen div
            await new Promise(resolve => setTimeout(resolve, 50));
    
            if (!pdfContainerRef.current) continue;
    
            try {
                const canvas = await html2canvas(pdfContainerRef.current, {
                    scale: 2, // Use a higher scale for better resolution
                    useCORS: true,
                    backgroundColor: '#2c3e50' // Match the presentation background
                });
    
                const imgData = canvas.toDataURL('image/jpeg', 0.9);
                
                if (index > 0) {
                    pdf.addPage();
                }
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    
            } catch (error) {
                console.error(`Failed to render slide ${index + 1} to PDF:`, error);
                if (index > 0) pdf.addPage();
                pdf.text(`Errore durante il rendering della diapositiva ${index + 1}`, 20, 20);
            }
        }
    
        pdf.save('presentazione_consulente_scv.pdf');
        
        // Cleanup
        setPdfRenderSlide(null);
        setIsSavingPdf(false);
    };

    async function handleUserMessage(transcript: string) {
        if (!chat || !isAiInitialized || isApiLocked || status === 'processing') return;
    
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            setSpeakingMessageId(null);
        }
    
        let imageToProcess = pastedImage;
        const fileToExamine = examineFile;
    
        if (screenStream) {
            setStatus('processing');
            try {
                imageToProcess = await captureScreenFrame();
            } catch (error) {
                console.error("Impossibile catturare il frame dello schermo:", error);
                const errorMsg: Message = { id: `system-err-capture-${Date.now()}`, sender: 'system', text: "Impossibile catturare un'immagine dallo schermo. Riprova." };
                setChatHistory(prev => [...prev, errorMsg]);
                setStatus('idle');
                return;
            }
        }
    
        const userMessage: Message = {
            id: `user-${Date.now()}`,
            sender: 'user',
            text: transcript,
            ...(imageToProcess && { image: { dataUrl: imageToProcess.dataUrl, name: imageToProcess.name } })
        };
        setChatHistory(prev => [...prev, userMessage]);
        setStatus('processing');
        setInputText('');
        setPastedImage(null); // Clear preview immediately after sending
    
        if (fileToExamine) {
             setChatHistory(prev => prev.filter(m => !m.id.startsWith('system-ready-')));
        }
    
        // Heuristic to detect a presentation request.
        const isPresentationRequest = /presentazione|diapositive|slideshow/i.test(transcript);
    
        // Use robust JSON mode for presentation requests (that don't include images).
        // JSON mode cannot be used with image inputs.
        if (isPresentationRequest && aiRef.current && !imageToProcess) {
            setChatHistory(prev => [...prev, {id: `system-proc-${Date.now()}`, sender: 'system', text: `OK, sto creando la struttura per la tua presentazione...`}]);
    
            try {
                let requestContents = transcript;
                if (fileToExamine) {
                    requestContents = `Analizza il seguente documento e, in base ad esso, crea una presentazione che risponda alla domanda. La tua risposta DEVE essere solo l'oggetto JSON.\n\n--- INIZIO DOCUMENTO DA ESAMINARE: ${fileToExamine.name} ---\n\n${fileToExamine.content}\n\n--- FINE DOCUMENTO DA ESAMINARE: ${fileToExamine.name} ---\n\nDomanda: ${transcript}`;
                }
    
                const result = await aiRef.current.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: requestContents,
                    config: {
                        systemInstruction: systemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                slides: {
                                    type: Type.ARRAY,
                                    description: "An array of slide objects.",
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            title: { type: Type.STRING, description: "The slide title." },
                                            text: { type: Type.STRING, description: "The slide text content, with Markdown for lists (e.g., - Item 1\\n- Item 2)." },
                                            image_prompt: { type: Type.STRING, description: "A detailed prompt in English for an image generator." },
                                        },
                                        required: ['title', 'text', 'image_prompt']
                                    }
                                }
                            },
                            required: ['slides']
                        },
                    }
                });
    
                const jsonResponse = result.text;
                const presentationData = JSON.parse(jsonResponse);
    
                if (presentationData && presentationData.slides && Array.isArray(presentationData.slides) && presentationData.slides.length > 0) {
                    generatePresentation(presentationData.slides);
                } else {
                    throw new Error("Il JSON ricevuto non è valido o non contiene diapositive.");
                }
    
            } catch (error) {
                console.error("Errore nella generazione della presentazione JSON:", error);
                const errorMessage = "Non sono riuscito a creare la presentazione. L'argomento potrebbe essere troppo complesso o si è verificato un errore. Riprova con una richiesta più semplice.";
                const errorSystemMessage: Message = {id: `system-err-${Date.now()}`, sender: 'system', text: errorMessage};
                setChatHistory(prev => [...prev, errorSystemMessage]);
            } finally {
                setStatus('idle');
                if (fileToExamine) setExamineFile(null);
            }
    
        } else {
            // Fallback to standard chat for all other cases (including presentation requests with images).
            try {
                let result: GenerateContentResponse;
    
                if (imageToProcess) {
                    const imagePart = {
                        inlineData: {
                            mimeType: imageToProcess.type,
                            data: imageToProcess.base64,
                        },
                    };
                    const textPrompt = transcript || "Cosa vedi in questa immagine?";
                    const textPart = { text: textPrompt };
    
                    result = await chat.sendMessage({ message: [textPart, imagePart] });
    
                } else {
                    let messageToSend = transcript;
                    if (fileToExamine) {
                        messageToSend = `Analizza il seguente documento e rispondi alla domanda che segue. Per la tua analisi, considera questo documento come l'oggetto principale della richiesta, ma basa la tua risposta sulla tua conoscenza specialistica del diritto italiano, del codice della strada, e su tutte le "Fonti di Conoscenza" che ti sono state fornite.\n\n--- INIZIO DOCUMENTO DA ESAMINARE: ${fileToExamine.name} ---\n\n${fileToExamine.content}\n\n--- FINE DOCUMENTO DA ESAMINARE: ${fileToExamine.name} ---\n\nDomanda: ${transcript}`;
                    }
                    result = await chat.sendMessage({ message: messageToSend });
                }
    
                // NO MORE JSON PARSING HERE. Treat response as plain text.
                const aiResponse = result.text;
    
                const groundingMetadata = result.candidates?.[0]?.groundingMetadata;
                const sources = (groundingMetadata?.groundingChunks?.filter(chunk => 'web' in chunk) as GroundingChunk[]) || [];
    
                const aiMessage: Message = {
                    id: `ai-${Date.now()}`,
                    sender: 'ai',
                    text: aiResponse,
                    sources: sources.length > 0 ? sources : undefined
                };
                setChatHistory(prev => [...prev, aiMessage]);
            } catch (error) {
                console.error("Errore nella risposta di Gemini:", error);
                const errorMessage = "È stato raggiunto il limite del piano gratuito dell'API. L'applicazione non attiverà alcun piano a pagamento. Attendi un minuto prima di riprovare.";
                const errorSystemMessage: Message = {id: `system-err-${Date.now()}`, sender: 'system', text: errorMessage};
                setChatHistory(prev => [...prev, errorSystemMessage]);
    
                setIsApiLocked(true);
                setTimeout(() => {
                    setIsApiLocked(false);
                }, 60000); // Lock for 60 seconds
            } finally {
                 setStatus('idle');
                if (fileToExamine) {
                    setExamineFile(null);
                }
            }
        }
    }
    
    // Effect to keep the ref to handleUserMessage always up to date
    useEffect(() => {
        handleUserMessageRef.current = handleUserMessage;
    });
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if ((inputText.trim() || pastedImage || screenStream) && isAiInitialized && status !== 'processing' && status !== 'listening' && !isApiLocked) {
                e.currentTarget.form?.requestSubmit();
            }
        }
    };

    const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if ((inputText.trim() || pastedImage || screenStream) && isAiInitialized && status !== 'processing' && status !== 'listening' && !isApiLocked) {
            handleUserMessage(inputText.trim());
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const dataUrl = event.target?.result as string;
                        const base64 = dataUrl.split(',')[1];
                        setPastedImage({
                            dataUrl,
                            name: file.name || `screenshot-${Date.now()}.png`,
                            type: file.type,
                            base64,
                        });
                        // Clear any file being examined to avoid confusion
                        if(examineFile) clearExamineFile();
                    };
                    reader.readAsDataURL(file);
                    e.preventDefault();
                    break;
                }
            }
        }
    };

    const clearPastedImage = () => {
        setPastedImage(null);
    };
    
    const toggleListen = () => {
        const recognition = recognitionRef.current;
        if (!recognition) {
            console.warn("Speech recognition not initialized.");
            return;
        }

        if (!isAiInitialized || isApiLocked || status === 'processing' || !!inputText.trim() || !!pastedImage) {
            return;
        }

        if (status === 'listening') {
            recognition.stop();
        } else {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
                setSpeakingMessageId(null);
            }
            try {
                recognition.start();
                setStatus('listening');
            } catch (e) {
                console.error("Error starting speech recognition:", e);
                setStatus('idle');
                setChatHistory(prev => [...prev, { id: `system-sr-start-err-${Date.now()}`, sender: 'system', text: "Impossibile avviare il microfono. Riprova." }]);
            }
        }
    };

    const handleShare = () => {
        const shareText = "Sto usando un Consulente SCV specializzato in conformità legale e finanziaria Vaticana.";
        navigator.clipboard.writeText(shareText).then(() => {
            setShareBtnText('Copiato!');
            setTimeout(() => setShareBtnText('Condividi App'), 2000);
        });
    };

    const getStatusText = (): string => {
        if (isApiLocked) {
            return "Limite del piano gratuito raggiunto. L'app sarà riattivata tra un minuto.";
        }
        if (!isAiInitialized) {
            return "Assistente non disponibile.";
        }
        if (screenStream) {
            return "Condivisione schermo attiva. Scrivi o detta una domanda."
        }
        switch (status) {
            case 'listening': return 'In ascolto...';
            case 'processing': return 'Sto pensando...';
            case 'idle':
            default:
                return 'Pronto per la tua domanda.';
        }
    };

    return (
        <>
            <header>
                 <div className="header-title">
                    <AppIcon />
                    <div className="title-container">
                        <h1>Consulente SCV</h1>
                        <p className="developer-credit">Developed by: D.A. Nenna</p>
                    </div>
                </div>
                <div className="header-actions">
                     <button className="header-button" onClick={() => setShowAboutModal(true)} aria-label="Informazioni sull'app" title="Informazioni sull'app">
                        <InfoIcon />
                    </button>
                    <button className="header-button" onClick={() => setShowPrivacyModal(true)} aria-label="Privacy e Sicurezza" title="Privacy e Sicurezza">
                        <ShieldIcon />
                    </button>
                    <button className="header-button knowledge-button" onClick={() => setShowSourcesModal(true)} aria-label="Gestisci fonti di conoscenza" title="Fonti di Conoscenza">
                        <KnowledgeBaseIcon />
                    </button>
                     <button className="header-button" onClick={() => setShowTemplatesModal(true)} aria-label="Gestisci modelli di lettera" title="Modelli di Lettera">
                        <ArticleIcon />
                    </button>
                    <button className="header-button" onClick={() => setShowSettings(!showSettings)} aria-label="Impostazioni audio" title="Impostazioni Audio">
                        <SettingsIcon />
                    </button>
                </div>
            </header>
            
            <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
            <input type="file" ref={sourcesFileInputRef} onChange={handleSourcesFileChange} multiple style={{ display: 'none' }} accept=".txt,.md,.json,.csv,.pdf,.docx,.xlsx,.xls" />
            <input type="file" ref={templatesFileInputRef} onChange={handleTemplatesFileChange} multiple style={{ display: 'none' }} accept=".txt,.md,.pdf,.docx" />
            <input type="file" ref={examineFileInputRef} onChange={handleExamineFileChange} style={{ display: 'none' }} accept=".txt,.md,.json,.csv,.pdf,.docx,.xlsx,.xls" />

            {showAboutModal && (
                <div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setShowAboutModal(false); }}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2 id="about-modal-title">Informazioni sul Consulente SCV</h2>
                            <button onClick={() => setShowAboutModal(false)} className="close-modal-button" aria-label="Chiudi">
                                &times;
                            </button>
                        </div>
                        <div className="modal-body about-modal-body">
                            <h3>Cos'è il Consulente SCV?</h3>
                            <p>
                                Il Consulente SCV è un assistente virtuale avanzato, specializzato in "Vatican Legal and Financial Compliance". Agisce come un esperto per analizzare la conformità normativa e finanziaria, interpretare documenti contabili e fornire supporto decisionale nel contesto specifico dello Stato della Città del Vaticano.
                            </p>
                            <h3>Aree di Competenza</h3>
                            <ul>
                                <li><strong>Diritto Canonico e Civile Vaticano:</strong> Comprensione approfondita della gerarchia delle fonti normative vaticane.</li>
                                <li><strong>Compliance Normativa:</strong> Analisi di documenti per la conformità alle leggi vaticane, inclusa la prevenzione del riciclaggio (AML) e del finanziamento del terrorismo (CTF).</li>
                                <li><strong>Analisi Finanziaria:</strong> Interpretazione di bilanci, flussi di cassa e rendiconti secondo i principi contabili vaticani.</li>
                                <li><strong>Consulenza e Due Diligence:</strong> Supporto nella redazione di contratti, valutazione di progetti e analisi dei rischi finanziari.</li>
                                <li><strong>Reporting e Rendicontazione:</strong> Generazione di report dettagliati per gli organi di controllo come la Segreteria per l'Economia.</li>
                            </ul>
                            <h3>Funzionalità Principali</h3>
                            <ul>
                                <li><strong>Analisi di documenti specifici:</strong> Puoi caricare i tuoi documenti (immagini, testo, screenshot, etc.) per ottenere risposte basate su casi specifici.</li>
                                <li><strong>Base di Conoscenza Personalizzata:</strong> Arricchisci l'assistente con le tue fonti per risposte ancora più precise e contestualizzate.</li>
                                <li><strong>Utilizzo di Modelli:</strong> Carica i tuoi modelli di lettera e chiedi all'assistente di compilarli automaticamente in base all'analisi dei documenti.</li>
                                <li><strong>Ricerca Google in tempo reale (Opzionale):</strong> Per notizie e aggiornamenti, puoi attivare la ricerca web per ottenere fonti verificate.</li>
                                <li><strong>Interazione Vocale Completa:</strong> Poni domande con la tua voce e ascolta le risposte, con opzioni per personalizzare la voce e la velocità di lettura.</li>
                            </ul>
                             <h3>Sviluppo</h3>
                            <p>Questa applicazione è stata sviluppata da Dante Alexander Nenna.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="share-app-button" onClick={handleShare}>
                               {shareBtnText}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showPrivacyModal && (
                 <div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title" onClick={(e) => { if (e.target === e.currentTarget) setShowPrivacyModal(false); }}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h2 id="privacy-modal-title">Privacy e Sicurezza</h2>
                            <button onClick={() => setShowPrivacyModal(false)} className="close-modal-button" aria-label="Chiudi">
                                &times;
                            </button>
                        </div>
                        <div className="modal-body about-modal-body">
                            <h3>Garanzie di Sicurezza</h3>
                            <p>
                                Questa applicazione opera utilizzando un account Google Workspace, garantendo a tutti gli utenti il massimo livello di protezione dei dati, indipendentemente dal tipo di account che utilizzano per accedervi. In conformità con le stringenti policy sulla privacy di Google Cloud per i clienti aziendali, i tuoi dati (incluse le conversazioni e i documenti analizzati) non vengono utilizzati per addestrare i modelli di intelligenza artificiale e non lasciano mai il perimetro di sicurezza dell'infrastruttura. <a href="https://cloud.google.com/privacy/docs/workspace-enterprise-privacy-commitments" target="_blank" rel="noopener noreferrer">Leggi le garanzie di Google Cloud sulla privacy</a>.
                            </p>
                            <h3>Sicurezza della Comunicazione</h3>
                            <p>
                                La comunicazione tra questa app e i server di Google è protetta da crittografia end-to-end (HTTPS), lo stesso standard di sicurezza usato dalle banche. Non ci sono server intermedi: i tuoi dati viaggiano direttamente e in modo sicuro.
                            </p>
                            <h3>Dati Salvati Localmente</h3>
                            <p>
                                Le "Fonti di Conoscenza" e i "Modelli" che carichi sono salvati esclusivamente nella memoria del tuo browser (<code>localStorage</code>) sul tuo dispositivo. Quando avvii una conversazione, il contenuto di questi file viene inviato in modo sicuro ai server di Google come contesto per la tua domanda. In accordo con le policy di Google Workspace, questi dati vengono usati solo per generare la risposta e non vengono conservati né usati per altri scopi.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <SourcesModal
                isOpen={showSourcesModal}
                onClose={() => setShowSourcesModal(false)}
                files={uploadedFiles}
                onFilesUpdate={setUploadedFiles}
                onAddFilesClick={() => sourcesFileInputRef.current?.click()}
                isProcessing={status === 'processing'}
            />

            <TemplatesModal
                isOpen={showTemplatesModal}
                onClose={() => setShowTemplatesModal(false)}
                templates={uploadedTemplates}
                onTemplatesUpdate={setUploadedTemplates}
                onAddTemplatesClick={() => templatesFileInputRef.current?.click()}
                isProcessing={status === 'processing'}
            />

            <PresentationLoadingModal message={presentationStatusMessage} />
            {showPresentation && (
                 <PresentationViewer
                    slides={presentationSlides}
                    currentSlide={currentSlide}
                    onClose={() => setShowPresentation(false)}
                    onNext={() => setCurrentSlide(s => Math.min(s + 1, presentationSlides.length - 1))}
                    onPrev={() => setCurrentSlide(s => Math.max(s - 1, 0))}
                    onSave={handleSavePresentation}
                    isSaving={isSavingPdf}
                />
            )}
            
            {/* Off-screen container for high-quality PDF rendering */}
            <div style={{
                position: 'absolute',
                left: '-9999px',
                top: 0,
                width: '1123px', /* A4 landscape at 96dpi */
                height: '794px',
            }} ref={pdfContainerRef}>
                {pdfRenderSlide && <PdfSlideView slide={pdfRenderSlide} />}
            </div>

            <div className={`settings-panel ${showSettings ? 'show' : ''}`}>
                <div className="setting-control">
                    <label htmlFor="voice-select">Voce Assistente</label>
                    <select 
                        id="voice-select"
                        value={selectedVoiceURI || ''}
                        onChange={(e) => setSelectedVoiceURI(e.target.value)}
                        disabled={voices.length === 0}
                    >
                        {voices.map(voice => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                                {voice.name} ({voice.lang})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="setting-control">
                    <label htmlFor="rate-select">Velocità ({speechRate}x)</label>
                    <input 
                        type="range" 
                        id="rate-select"
                        min="0.5" 
                        max="2" 
                        step="0.1"
                        value={speechRate}
                        onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                    />
                </div>
                 <div className="setting-control checkbox-control">
                    <input
                        type="checkbox"
                        id="google-search-toggle"
                        checked={useGoogleSearch}
                        onChange={(e) => setUseGoogleSearch(e.target.checked)}
                    />
                    <label htmlFor="google-search-toggle">Abilita Ricerca Google</label>
                    <p className="setting-description">
                        Se attiva, l'assistente cercherà sul web informazioni aggiornate non presenti nelle fonti. La chat verrà resettata.
                    </p>
                </div>
            </div>

            <main className="chat-container" ref={chatContainerRef}>
                {chatHistory.map((msg) => {
                    const isEditing = editingMessageId === msg.id;
                    return (
                        <div key={msg.id} id={`message-${msg.id}`} className={`chat-message ${msg.sender}`}>
                            <div className="message-header">
                                <strong>{msg.sender === 'user' ? 'Tu' : (msg.sender === 'system' ? 'Sistema' : 'Consulente SCV')}</strong>
                                {(msg.sender === 'ai' || msg.sender === 'user') && (
                                    <div className="message-actions">
                                        {msg.sender === 'ai' && (
                                            isEditing ? (
                                                <>
                                                    <button
                                                        onClick={() => handleSaveEdit(msg.id)}
                                                        className="message-action-button save-button"
                                                        aria-label="Salva modifiche"
                                                        title="Salva modifiche"
                                                    >
                                                        <SaveIcon />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="message-action-button cancel-button"
                                                        aria-label="Annulla modifiche"
                                                        title="Annulla modifiche"
                                                    >
                                                        <CancelIcon />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleCopy(msg.text, msg.id)}
                                                        className="message-action-button"
                                                        aria-label={copiedMessageId === msg.id ? "Copiato" : "Copia messaggio"}
                                                        title={copiedMessageId === msg.id ? "Copiato!" : "Copia Testo (per WhatsApp)"}
                                                    >
                                                        {copiedMessageId === msg.id ? <SaveIcon /> : <CopyIcon />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDownload(msg.text)}
                                                        className="message-action-button"
                                                        aria-label="Scarica come documento Word"
                                                        title="Scarica come Word"
                                                    >
                                                        <DownloadIcon />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleSpeak(msg.text, msg.id)} 
                                                        className="message-action-button"
                                                        aria-label={speakingMessageId === msg.id ? "Ferma la lettura" : "Ascolta il messaggio"}
                                                        title={speakingMessageId === msg.id ? "Ferma la lettura" : "Ascolta il messaggio"}
                                                    >
                                                        {speakingMessageId === msg.id ? <SoundWaveIcon /> : <SpeakerIcon />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditMessage(msg)}
                                                        className="message-action-button"
                                                        aria-label="Modifica messaggio"
                                                        title="Modifica messaggio"
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                </>
                                            )
                                        )}
                                        <button
                                            onClick={() => handleDeleteMessage(msg.id)}
                                            className="message-action-button delete-button"
                                            aria-label="Elimina messaggio"
                                            title="Elimina messaggio"
                                        >
                                            <DeleteIcon />
                                        </button>
                                    </div>
                                )}
                            </div>
                            {msg.image && (
                                <div className="message-image-container">
                                    <img src={msg.image.dataUrl} alt={msg.image.name} className="message-image" />
                                </div>
                            )}
                            <div className="message-body-container">
                                <div style={{ visibility: isEditing ? 'hidden' : 'visible' }}>
                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                </div>
                                {isEditing && (
                                    <textarea
                                        ref={editTextAreaRef}
                                        className="edit-textarea"
                                        value={editText}
                                        onChange={(e) => setEditText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSaveEdit(msg.id);
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                handleCancelEdit();
                                            }
                                        }}
                                        autoFocus
                                    />
                                )}
                            </div>
                            {msg.sources && msg.sources.length > 0 && (
                                <div className="message-sources">
                                    <strong>Fonti Web:</strong>
                                    <ul>
                                        {msg.sources.map((source, index) => (
                                            <li key={index}>
                                                <a
                                                    href={source.web.uri}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        window.open(source.web.uri, '_blank', 'noopener,noreferrer');
                                                    }}
                                                >
                                                    {source.web.title || source.web.uri}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    );
                })}
                 {status === 'processing' && chatHistory.length > 1 && (
                    <div className="chat-message ai thinking">
                        <div className="message-header"><strong>Consulente SCV</strong></div>
                        <div className="typing-indicator">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}
            </main>
            <footer className="controls-container">
                {pastedImage && (
                    <div className="pasted-image-banner">
                        <img src={pastedImage.dataUrl} alt="Anteprima immagine incollata" />
                        <span>{pastedImage.name}</span>
                        <button onClick={clearPastedImage} aria-label="Rimuovi immagine">&times;</button>
                    </div>
                )}
                {examineFile && (
                    <div className="examine-file-banner">
                        <span>File in analisi: <strong>{examineFile.name}</strong></span>
                        <button onClick={clearExamineFile} aria-label="Annulla analisi file">&times;</button>
                    </div>
                )}
                 {screenStream && (
                    <div className="screen-share-banner">
                        <span>Condivisione schermo attiva.</span>
                        <button onClick={handleToggleScreenShare}>Interrompi</button>
                    </div>
                )}
                <div className="input-area">
                    <form className="text-input-form" onSubmit={handleTextSubmit}>
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            placeholder={
                                pastedImage ? "Aggiungi un commento all'immagine..." :
                                (examineFile ? `Fai una domanda su ${examineFile.name}...` : 
                                (screenStream ? "Fai una domanda sullo schermo..." : "Scrivi un messaggio..."))
                            }
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={(e) => { if (!screenStream) handlePaste(e); }}
                            disabled={!isAiInitialized || status === 'listening' || status === 'processing' || isApiLocked}
                            aria-label="Messaggio da inviare"
                        />
                        <button
                            type="submit"
                            disabled={!isAiInitialized || (!inputText.trim() && !pastedImage && !screenStream) || status === 'listening' || status === 'processing' || isApiLocked}
                            aria-label="Invia messaggio"
                        >
                            <SendIcon />
                        </button>
                    </form>
                    <button
                        id="examine-doc-button"
                        onClick={() => examineFileInputRef.current?.click()}
                        disabled={status === 'processing' || isApiLocked || !!screenStream}
                        aria-label="Esamina Documento"
                        title="Esamina Documento"
                    >
                        <AttachmentIcon />
                    </button>
                    <button
                        id="screenshare-button"
                        className={screenStream ? 'active' : ''}
                        onClick={handleToggleScreenShare}
                        disabled={status === 'processing' || isApiLocked}
                        aria-label={screenStream ? "Interrompi condivisione schermo" : "Condividi lo schermo"}
                        title={screenStream ? "Interrompi condivisione schermo" : "Condividi lo schermo"}
                    >
                       {screenStream ? <StopIcon /> : <ScreenShareIcon />}
                    </button>
                    <button 
                        id="mic-button" 
                        className={status}
                        onClick={toggleListen}
                        disabled={!isAiInitialized || status === 'processing' || !!inputText.trim() || isApiLocked || !!pastedImage}
                        aria-label={status === 'listening' ? 'Smetti di ascoltare' : 'Inizia ad ascoltare'}
                    >
                        {status === 'processing' ? <Spinner /> : (status === 'listening' ? <StopIcon /> : <MicIcon />) }
                    </button>
                </div>
                <p id="status">{getStatusText()}</p>
            </footer>
        </>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<AppContainer />);
