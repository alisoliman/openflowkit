import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

interface UseAIViewStateParams {
    searchQuery: string;
    isGenerating: boolean;
    onAIGenerate: (prompt: string, imageBase64?: string) => Promise<boolean>;
    onClose: () => void;
    /** Follow new chat content while the reader is near the bottom. */
    scrollKey: string | number;
}

interface UseAIViewStateResult {
    prompt: string;
    setPrompt: (value: string) => void;
    selectedImage: string | null;
    setSelectedImage: (value: string | null) => void;
    fileInputRef: RefObject<HTMLInputElement>;
    scrollRef: RefObject<HTMLDivElement>;
    isScrolledUp: boolean;
    scrollToLatest: () => void;
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
    const followsLatest = useRef(true);
    const [isScrolledUp, setIsScrolledUp] = useState(false);

    const scrollToLatest = useCallback(() => {
        followsLatest.current = true;
        setIsScrolledUp(false);
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, []);

    const setPrompt = useCallback((value: string) => {
        draftRevision.current += 1;
        setPromptState(value);
    }, []);

    const setSelectedImage = useCallback((value: string | null) => {
        draftRevision.current += 1;
        setSelectedImageState(value);
    }, []);

    useLayoutEffect(() => {
        if (scrollRef.current && followsLatest.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [scrollKey]);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        const onScroll = () => {
            const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
            followsLatest.current = nearBottom;
            setIsScrolledUp(!nearBottom);
        };
        container.addEventListener('scroll', onScroll, { passive: true });
        return () => container.removeEventListener('scroll', onScroll);
    }, [scrollKey]);

    async function handleGenerate(text?: string): Promise<void> {
        const promptText = text || prompt;
        if ((!promptText.trim() && !selectedImage) || isGenerating || submitting.current) return;

        const submittedImage = selectedImage;
        const submittedRevision = draftRevision.current;
        submitting.current = true;
        scrollToLatest();
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
        // Enter also commits an IME candidate; it must not send a partial message.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    }

    function handleImageSelect(e: ChangeEvent<HTMLInputElement>): void {
        const file = e.target.files?.[0];
        if (!file) return;
        // The same image can be selected again after it is removed or submitted.
        e.target.value = '';

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
        isScrolledUp,
        scrollToLatest,
        handleGenerate,
        handleKeyDown,
        handleImageSelect,
    };
}
