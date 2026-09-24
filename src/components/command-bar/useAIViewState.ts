import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

interface UseAIViewStateParams {
    searchQuery: string;
    isGenerating: boolean;
    onAIGenerate: (prompt: string, imageBase64?: string) => Promise<boolean>;
    onClose: () => void;
    /** The chat scrolls to the bottom whenever this changes. */
    scrollKey: string | number;
}

interface UseAIViewStateResult {
    prompt: string;
    setPrompt: (value: string) => void;
    selectedImage: string | null;
    setSelectedImage: (value: string | null) => void;
    fileInputRef: RefObject<HTMLInputElement>;
    scrollRef: RefObject<HTMLDivElement>;
    handleGenerate: (text?: string) => Promise<void>;
    handleKeyDown: (e: KeyboardEvent) => void;
    handleImageSelect: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function useAIViewState({
    searchQuery,
    isGenerating,
    onAIGenerate,
    onClose,
    scrollKey,
}: UseAIViewStateParams): UseAIViewStateResult {
    const [prompt, setPromptState] = useState(searchQuery || '');
    const [selectedImage, setSelectedImageState] = useState<string | null>(null);
    const draftRevision = useRef(0);
    const submitting = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const setPrompt = useCallback((value: string) => {
        draftRevision.current += 1;
        setPromptState(value);
    }, []);

    const setSelectedImage = useCallback((value: string | null) => {
        draftRevision.current += 1;
        setSelectedImageState(value);
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [scrollKey]);

    async function handleGenerate(text?: string): Promise<void> {
        const promptText = text || prompt;
        if ((!promptText.trim() && !selectedImage) || isGenerating || submitting.current) return;

        const submittedImage = selectedImage;
        const submittedRevision = draftRevision.current;
        submitting.current = true;
        setPromptState('');
        setSelectedImageState(null);

        let didGenerate = false;
        try {
            didGenerate = await onAIGenerate(promptText, submittedImage || undefined);
            if (didGenerate) onClose();
        } finally {
            submitting.current = false;
            // A failed request must not replace a newer draft, even if the user
            // deliberately typed and then cleared that draft while waiting.
            if (!didGenerate && draftRevision.current === submittedRevision) {
                setPromptState(promptText);
                setSelectedImageState(submittedImage);
            }
        }
    }

    function handleKeyDown(e: KeyboardEvent): void {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    }

    function handleImageSelect(e: ChangeEvent<HTMLInputElement>): void {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            setSelectedImage(reader.result as string);
        };
        reader.readAsDataURL(file);
    }

    return {
        prompt,
        setPrompt,
        selectedImage,
        setSelectedImage,
        fileInputRef,
        scrollRef,
        handleGenerate,
        handleKeyDown,
        handleImageSelect,
    };
}
