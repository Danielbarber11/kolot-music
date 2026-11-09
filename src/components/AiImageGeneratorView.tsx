import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Download,
  Copy,
  Check,
  RefreshCw,
  Maximize2,
  X,
  Palette,
  Sliders,
  History,
  Trash2,
  Image as ImageIcon,
  Search,
  Wand2,
  UserCheck,
  Film,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Layers,
  Upload,
  Play,
  Square,
  Camera,
  SlidersHorizontal,
  CheckCircle2,
  ArrowRight,
  Sun,
  Eye,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language } from '../types';
import { enhancePromptForImage, getPerchanceImageUrl } from '../services/aiProviders';

export interface GalleryItem {
  id: string;
  url: string;
  prompt: string;
  source: 'generator' | 'ai-edit' | 'manual-edit' | 'web-search' | 'face-swap' | 'anim-frame';
  aspectRatio?: string;
  createdAt: string;
}

interface AiImageGeneratorViewProps {
  lang: Language;
}

type TabType = 'generator' | 'manual-edit' | 'web-search' | 'ai-edit' | 'face-swap' | 'anim';

const INSPIRATION_PROMPTS_HE = [
  'עיר עתידנית בלילה עם אורות ניאון סייברפאנק ורחובות גשומים',
  'ציור שמן אימפרסיוניסטי של סמטאות ירושלים העתיקה באור שקיעה זהוב',
  'אסטרונאוט מרחף בחלל ושותה כוס קפה מול כדור הארץ הזוהר',
  'נוף הרים אלפיני דרמטי עם אגם טורקיז מנצנץ ויער עצי מחט',
  'דיוקן ריאליסטי מרהיב בתאורת סטודיו רכה ועומק שדה קולנועי',
  'יער פנטזיה קסום עם פטריות זוהרות, גחליליות ומעיינות מוארים',
  'ספינת מפרשים עתיקה שטה באוקיינוס גלי תחת שמי כוכבים וערפילית',
  'גן יפני מסורתי בעונת פריחת הדובדבן עם גשר עץ ואגם קוי',
];

const INSPIRATION_PROMPTS_EN = [
  'Cyberpunk futuristic city at night with glowing neon reflections on wet streets',
  'Impressionist oil painting of old Jerusalem alleys under golden hour sunlight',
  'Astronaut floating peacefully in deep space drinking coffee overlooking Earth',
  'Cinematic alpine mountain landscape with crystal clear turquoise reflection lake',
  'Ultra-detailed photorealistic portrait with soft natural window lighting and bokeh',
  'Enchanted fantasy forest with bioluminescent mushrooms and magical glowing mist',
  'Majestic tall wooden pirate ship sailing turbulent ocean under starry galaxy sky',
  'Serene Japanese zen garden in cherry blossom spring with wooden bridge and koi pond',
];

export const AiImageGeneratorView: React.FC<AiImageGeneratorViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<TabType>('generator');

  // Shared Gallery
  const [gallery, setGallery] = useState<GalleryItem[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_ai_gallery_v2');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('wikiarchive_ai_gallery_v2', JSON.stringify(gallery));
    } catch {
      // ignore storage quota issues
    }
  }, [gallery]);

  const addGalleryItem = (item: GalleryItem) => {
    setGallery((prev) => [item, ...prev.filter((g) => g.id !== item.id)].slice(0, 50));
  };

  const removeGalleryItem = (id: string) => {
    setGallery((prev) => prev.filter((item) => item.id !== id));
  };

  // Fullscreen Modal
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // -------------------------------------------------------------
  // TAB 1: AI IMAGE GENERATOR
  // -------------------------------------------------------------
  const [genPrompt, setGenPrompt] = useState('');
  const [genStyle, setGenStyle] = useState<'artistic' | 'photorealistic' | 'anime' | 'cinematic' | 'fantasy' | '3d' | 'oil' | 'cyberpunk'>('artistic');
  const [genAspectRatio, setGenAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
  const [genCount, setGenCount] = useState<number>(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [enhancedPrompt, setEnhancedPrompt] = useState('');
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [lastGeneratedBatch, setLastGeneratedBatch] = useState<GalleryItem[]>([]);

  const handleEnhanceGenPrompt = async () => {
    if (!genPrompt.trim() || isEnhancingPrompt) return;
    setIsEnhancingPrompt(true);
    try {
      const res = await enhancePromptForImage(genPrompt);
      setEnhancedPrompt(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsEnhancingPrompt(false);
    }
  };

  const handleGenerateImages = async (overridePrompt?: string) => {
    const textToUse = (overridePrompt || genPrompt).trim();
    if (!textToUse) return;

    setIsGenerating(true);

    let visualPrompt = enhancedPrompt;
    if (!visualPrompt || overridePrompt) {
      try {
        visualPrompt = await enhancePromptForImage(textToUse);
        setEnhancedPrompt(visualPrompt);
      } catch {
        visualPrompt = textToUse;
      }
    }

    try {
      const res = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: visualPrompt,
          stylePreset: genStyle,
          aspectRatio: genAspectRatio,
          count: genCount,
        }),
      });

      const data = await res.json();
      const images: string[] = data.images || [];

      const newBatch: GalleryItem[] = images.map((imgUrl, idx) => ({
        id: `gen_${Date.now()}_${idx}`,
        url: imgUrl,
        prompt: textToUse,
        source: 'generator',
        aspectRatio: genAspectRatio,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));

      setLastGeneratedBatch(newBatch);
      newBatch.forEach((item) => addGalleryItem(item));
    } catch (err) {
      console.error('Image Generation Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  // -------------------------------------------------------------
  // TAB 2: MANUAL EDITOR (imgEditPanel)
  // -------------------------------------------------------------
  const [editImageSrc, setEditImageSrc] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [blur, setBlur] = useState(0);
  const [grayscale, setGrayscale] = useState(0);
  const [sepia, setSepia] = useState(0);
  const [hueRotate, setHueRotate] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleUploadImageForEdit = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          setEditImageSrc(String(evt.target.result));
          resetEditorFilters();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const resetEditorFilters = () => {
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setBlur(0);
    setGrayscale(0);
    setSepia(0);
    setHueRotate(0);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  useEffect(() => {
    if (!editImageSrc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = editImageSrc;
    img.onload = () => {
      const isRotatedHalf = Math.abs(rotation % 180) === 90;
      canvas.width = isRotatedHalf ? img.height : img.width;
      canvas.height = isRotatedHalf ? img.width : img.height;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) hue-rotate(${hueRotate}deg)`;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    };
  }, [editImageSrc, brightness, contrast, saturation, blur, grayscale, sepia, hueRotate, rotation, flipH, flipV]);

  const handleSaveEditedImage = (format: 'image/png' | 'image/jpeg') => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL(format, 0.95);
    const item: GalleryItem = {
      id: `manual_${Date.now()}`,
      url: dataUrl,
      prompt: isHe ? 'תמונה מעובדת בעורך ידני' : 'Manually Edited Image',
      source: 'manual-edit',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    addGalleryItem(item);
    alert(isHe ? 'התמונה נשמרה בהצלחה לגלריה!' : 'Image saved to gallery!');
  };

  // -------------------------------------------------------------
  // TAB 3: WEB IMAGE SEARCH (webSearchBox - DuckDuckGo / Openverse)
  // -------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchWebImages = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() || isSearching) return;

    setIsSearching(true);
    try {
      const res = await fetch(`/api/ai/search-images?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // -------------------------------------------------------------
  // TAB 4: AI WORDS EDIT (aiEditBox)
  // -------------------------------------------------------------
  const [aiEditSourceImg, setAiEditSourceImg] = useState<string | null>(null);
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [isAiEditing, setIsAiEditing] = useState(false);
  const [aiEditedResult, setAiEditedResult] = useState<string | null>(null);

  const handleUploadAiEditSource = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          setAiEditSourceImg(String(evt.target.result));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRunAiEdit = async () => {
    if (!aiEditInstruction.trim() || isAiEditing) return;
    setIsAiEditing(true);

    try {
      const res = await fetch('/api/ai/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: aiEditSourceImg,
          instruction: aiEditInstruction,
          count: 1,
        }),
      });

      const data = await res.json();
      if (data.images && data.images[0]) {
        const editedUrl = data.images[0];
        setAiEditedResult(editedUrl);

        const item: GalleryItem = {
          id: `aiedit_${Date.now()}`,
          url: editedUrl,
          prompt: aiEditInstruction,
          source: 'ai-edit',
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        addGalleryItem(item);
      }
    } catch (err) {
      console.error('AI Edit Error:', err);
    } finally {
      setIsAiEditing(false);
    }
  };

  // -------------------------------------------------------------
  // TAB 5: FACE SWAP (faceSwapPanel - Local Composite)
  // -------------------------------------------------------------
  const [bodyImgSrc, setBodyImgSrc] = useState<string | null>(null);
  const [faceImgSrc, setFaceImgSrc] = useState<string | null>(null);
  const [faceScale, setFaceScale] = useState(0.35);
  const [faceX, setFaceX] = useState(0.5);
  const [faceY, setFaceY] = useState(0.3);
  const [faceRot, setFaceRot] = useState(0);
  const [faceFeather, setFaceFeather] = useState(0.3);
  const [faceBrightness, setFaceBrightness] = useState(100);

  const faceSwapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleUploadBody = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => evt.target?.result && setBodyImgSrc(String(evt.target.result));
      reader.readAsDataURL(file);
    }
  };

  const handleUploadFace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => evt.target?.result && setFaceImgSrc(String(evt.target.result));
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (!bodyImgSrc || !faceSwapCanvasRef.current) return;
    const canvas = faceSwapCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bodyImg = new Image();
    bodyImg.crossOrigin = 'anonymous';
    bodyImg.src = bodyImgSrc;
    bodyImg.onload = () => {
      canvas.width = bodyImg.width;
      canvas.height = bodyImg.height;

      // Draw Body pixel-for-pixel exact
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bodyImg, 0, 0);

      // If face image present, overlay with oval mask and transformations
      if (faceImgSrc) {
        const faceImg = new Image();
        faceImg.crossOrigin = 'anonymous';
        faceImg.src = faceImgSrc;
        faceImg.onload = () => {
          ctx.save();
          const targetX = canvas.width * faceX;
          const targetY = canvas.height * faceY;
          const targetW = canvas.width * faceScale;
          const targetH = targetW * (faceImg.height / faceImg.width);

          ctx.translate(targetX, targetY);
          ctx.rotate((faceRot * Math.PI) / 180);

          // Oval clipping mask for face
          ctx.beginPath();
          ctx.ellipse(0, 0, targetW / 2, targetH / 2, 0, 0, 2 * Math.PI);
          ctx.clip();

          ctx.filter = `brightness(${faceBrightness}%)`;
          ctx.drawImage(faceImg, -targetW / 2, -targetH / 2, targetW, targetH);

          ctx.restore();
        };
      }
    };
  }, [bodyImgSrc, faceImgSrc, faceScale, faceX, faceY, faceRot, faceFeather, faceBrightness]);

  const handleSaveFaceSwap = () => {
    if (!faceSwapCanvasRef.current) return;
    const dataUrl = faceSwapCanvasRef.current.toDataURL('image/png');
    const item: GalleryItem = {
      id: `faceswap_${Date.now()}`,
      url: dataUrl,
      prompt: isHe ? 'החלפת פנים קוסטום' : 'Custom Face Swap',
      source: 'face-swap',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    addGalleryItem(item);
    alert(isHe ? 'התמונה נשמרה בהצלחה לגלריה!' : 'Face swapped image saved!');
  };

  // -------------------------------------------------------------
  // TAB 6: ANIMATION (animPanel - Camera Motion & WebM Recording)
  // -------------------------------------------------------------
  const [animSourceImg, setAnimSourceImg] = useState<string | null>(null);
  const [animMotion, setAnimMotion] = useState<'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'zoom-pan' | 'orbit'>('zoom-pan');
  const [animDuration, setAnimDuration] = useState<number>(5);
  const [animResolution, setAnimResolution] = useState<'original' | '720p' | '480p'>('720p');
  const [isAnimRecording, setIsAnimRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);

  const animCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animAnimFrameId = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const handleUploadAnimSource = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => evt.target?.result && setAnimSourceImg(String(evt.target.result));
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (!animSourceImg || !animCanvasRef.current) return;
    const canvas = animCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = animSourceImg;

    img.onload = () => {
      let targetW = img.width;
      let targetH = img.height;

      if (animResolution === '720p') {
        targetW = 1280;
        targetH = 720;
      } else if (animResolution === '480p') {
        targetW = 854;
        targetH = 480;
      }

      canvas.width = targetW;
      canvas.height = targetH;

      let startTime = performance.now();

      const renderFrame = (now: number) => {
        const elapsed = (now - startTime) / 1000;
        const progress = (elapsed % animDuration) / animDuration;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();

        let scale = 1.0;
        let dx = 0;
        let dy = 0;

        switch (animMotion) {
          case 'zoom-in':
            scale = 1.0 + progress * 0.35;
            break;
          case 'zoom-out':
            scale = 1.35 - progress * 0.35;
            break;
          case 'pan-left':
            dx = -progress * (canvas.width * 0.15);
            scale = 1.15;
            break;
          case 'pan-right':
            dx = progress * (canvas.width * 0.15);
            scale = 1.15;
            break;
          case 'pan-up':
            dy = -progress * (canvas.height * 0.15);
            scale = 1.15;
            break;
          case 'pan-down':
            dy = progress * (canvas.height * 0.15);
            scale = 1.15;
            break;
          case 'zoom-pan':
            scale = 1.05 + progress * 0.25;
            dx = Math.sin(progress * Math.PI * 2) * (canvas.width * 0.05);
            dy = Math.cos(progress * Math.PI * 2) * (canvas.height * 0.05);
            break;
          case 'orbit':
            scale = 1.12;
            dx = Math.sin(progress * Math.PI * 2) * (canvas.width * 0.08);
            dy = Math.cos(progress * Math.PI * 2) * (canvas.height * 0.08);
            break;
        }

        ctx.translate(canvas.width / 2 + dx, canvas.height / 2 + dy);
        ctx.scale(scale, scale);

        // Draw image keeping ratio
        const imgRatio = img.width / img.height;
        const canvasRatio = canvas.width / canvas.height;
        let renderW = canvas.width;
        let renderH = canvas.height;

        if (imgRatio > canvasRatio) {
          renderH = canvas.height;
          renderW = renderH * imgRatio;
        } else {
          renderW = canvas.width;
          renderH = renderW / imgRatio;
        }

        ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);
        ctx.restore();

        animAnimFrameId.current = requestAnimationFrame(renderFrame);
      };

      if (animAnimFrameId.current) cancelAnimationFrame(animAnimFrameId.current);
      animAnimFrameId.current = requestAnimationFrame(renderFrame);
    };

    return () => {
      if (animAnimFrameId.current) cancelAnimationFrame(animAnimFrameId.current);
    };
  }, [animSourceImg, animMotion, animDuration, animResolution]);

  const handleCaptureAnimFrame = () => {
    if (!animCanvasRef.current) return;
    const dataUrl = animCanvasRef.current.toDataURL('image/png');
    const item: GalleryItem = {
      id: `frame_${Date.now()}`,
      url: dataUrl,
      prompt: isHe ? 'פריים לכוד מתוך הנפשה' : 'Captured Animation Frame',
      source: 'anim-frame',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    addGalleryItem(item);
    alert(isHe ? 'הפריים נשמר בהצלחה לגלריה!' : 'Frame saved to gallery!');
  };

  const handleStartRecordWebm = () => {
    if (!animCanvasRef.current || isAnimRecording) return;
    const canvas = animCanvasRef.current;
    const stream = canvas.captureStream(30);

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    recordedChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000,
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const videoUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `anim_motion_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(videoUrl);
      setIsAnimRecording(false);
      setRecordingProgress(0);
    };

    mediaRecorder.start();
    setIsAnimRecording(true);

    const startTime = Date.now();
    const totalMs = animDuration * 1000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
      setRecordingProgress(pct);

      if (elapsed >= totalMs) {
        clearInterval(interval);
        mediaRecorder.stop();
      }
    }, 100);
  };

  // Helper to trigger direct Edit from Gallery
  const handleOpenInManualEdit = (url: string) => {
    setEditImageSrc(url);
    resetEditorFilters();
    setActiveTab('manual-edit');
  };

  const handleOpenInAiEdit = (url: string) => {
    setAiEditSourceImg(url);
    setActiveTab('ai-edit');
  };

  const handleOpenInFaceSwap = (url: string) => {
    setBodyImgSrc(url);
    setActiveTab('face-swap');
  };

  const handleOpenInAnim = (url: string) => {
    setAnimSourceImg(url);
    setActiveTab('anim');
  };

  const handleDownloadImage = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${filename}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 space-y-6">
      {/* Top Header & Navigation Bar */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <span>{isHe ? 'AI Image Generator + עורך תמונות מתקדם' : 'AI Image Suite + Photo Editor'}</span>
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                v2.0 Quantum
              </span>
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {isHe
                ? 'מחולל פרומפטים, עורך פילטרים ידני, חיפוש ברשת, עריכה מילולית, החלפת פנים והנפשת מצלמה מקומית'
                : 'Text-to-image generator, manual filter editor, web search, AI face swap, & video camera motion'}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 w-full lg:w-auto">
          {[
            { id: 'generator', label: isHe ? 'מחולל AI' : 'Generator', icon: Sparkles },
            { id: 'manual-edit', label: isHe ? 'עורך ידני' : 'Manual Edit', icon: Sliders },
            { id: 'web-search', label: isHe ? 'חיפוש ברשת' : 'Web Search', icon: Search },
            { id: 'ai-edit', label: isHe ? 'עריכה במילים' : 'AI Edit', icon: Wand2 },
            { id: 'face-swap', label: isHe ? 'החלפת פנים' : 'Face Swap', icon: UserCheck },
            { id: 'anim', label: isHe ? 'הנפשת תמונות' : 'Animation', icon: Film },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* TAB 1: AI IMAGE GENERATOR PANEL                                    */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-indigo-600" />
                    <span>{isHe ? 'תיאור התמונה שברצונך ליצור:' : 'Prompt Description:'}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">{genPrompt.length}/500</span>
                </label>
                <textarea
                  value={genPrompt}
                  onChange={(e) => {
                    setGenPrompt(e.target.value);
                    setEnhancedPrompt('');
                  }}
                  placeholder={
                    isHe
                      ? 'תאר כאן את התמונה שאתה רוצה ליצור... (לדוגמה: עיר עתידנית בלילה בציור שמן מרהיב)'
                      : 'Describe what you want to generate in detail...'
                  }
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none font-medium"
                />

                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={handleEnhanceGenPrompt}
                    disabled={isEnhancingPrompt || !genPrompt.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isEnhancingPrompt ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{isHe ? 'משפר...' : 'Enhancing...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>{isHe ? 'שפר ותרגם לאנגלית' : 'Enhance Prompt'}</span>
                      </>
                    )}
                  </button>
                  <span className="text-[10px] text-slate-400">{isHe ? 'דיוק ויזואלי גבוה' : 'Enhanced prompt'}</span>
                </div>

                {enhancedPrompt && (
                  <div className="mt-2 p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-[11px] text-slate-700 font-mono">
                    <span className="font-bold text-slate-900 block mb-0.5">{isHe ? 'פרומפט מודגש שנשלח למודל:' : 'Visual Prompt:'}</span>
                    <p className="line-clamp-2">{enhancedPrompt}</p>
                  </div>
                )}
              </div>

              {/* Style Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">{isHe ? 'בחירת סגנון אומנותי:' : 'Style Preset:'}</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'artistic', label: isHe ? 'אומנותי' : 'Artistic' },
                    { id: 'photorealistic', label: isHe ? 'ריאליסטי' : 'Photoreal' },
                    { id: 'anime', label: isHe ? 'אנימה' : 'Anime' },
                    { id: 'cinematic', label: isHe ? 'קולנועי' : 'Cinematic' },
                    { id: 'fantasy', label: isHe ? 'פנטזיה' : 'Fantasy' },
                    { id: '3d', label: isHe ? 'תלת-ממד' : '3D Render' },
                    { id: 'oil', label: isHe ? 'ציור שמן' : 'Oil Painting' },
                    { id: 'cyberpunk', label: isHe ? 'סייברפאנק' : 'Cyberpunk' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setGenStyle(st.id as any)}
                      className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer text-xs font-bold ${
                        genStyle === st.id
                          ? 'bg-purple-50 border-purple-500 text-purple-900 ring-1 ring-purple-500'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">{isHe ? 'יחס תמונה (מידות):' : 'Aspect Ratio:'}</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { id: '1:1', label: '1:1', sub: isHe ? 'מרובע' : 'Square' },
                    { id: '16:9', label: '16:9', sub: isHe ? 'רחב' : 'Wide' },
                    { id: '9:16', label: '9:16', sub: isHe ? 'סטורי' : 'Story' },
                    { id: '4:3', label: '4:3', sub: isHe ? 'קלאסי' : 'Classic' },
                    { id: '3:4', label: '3:4', sub: isHe ? 'פורטרט' : 'Portrait' },
                  ].map((ar) => (
                    <button
                      key={ar.id}
                      type="button"
                      onClick={() => setGenAspectRatio(ar.id as any)}
                      className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer ${
                        genAspectRatio === ar.id
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-900 font-extrabold ring-1 ring-indigo-500'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <div className="text-xs font-black">{ar.label}</div>
                      <div className="text-[8px] text-slate-400">{ar.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity Picker */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                  <span>{isHe ? 'כמות תמונות ליצירה במקביל:' : 'Number of Images:'}</span>
                  <span className="text-xs font-black text-indigo-600">{genCount} {isHe ? 'תמונות' : 'images'}</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setGenCount(num)}
                      className={`py-2 rounded-xl border text-center transition-all cursor-pointer text-xs font-black ${
                        genCount === num
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/20'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {num} {num === 1 ? (isHe ? 'תמונה' : 'Image') : (isHe ? 'תמונות' : 'Images')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate Button */}
              <button
                type="button"
                onClick={() => handleGenerateImages()}
                disabled={isGenerating || !genPrompt.trim()}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white font-black text-sm shadow-lg shadow-purple-600/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isHe ? 'יוצר תמונות בבינה מלאכותית...' : 'Generating Images...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>{isHe ? `צור ${genCount} תמונות עכשיו` : `Generate ${genCount} Images`}</span>
                  </>
                )}
              </button>
            </div>

            {/* Inspiration Prompts */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>{isHe ? 'רעיונות לפרומפטים מעניינים:' : 'Inspiration Prompts:'}</span>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(isHe ? INSPIRATION_PROMPTS_HE : INSPIRATION_PROMPTS_EN).map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setGenPrompt(p);
                      handleGenerateImages(p);
                    }}
                    className="text-xs px-3 py-1.5 rounded-full bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-800 transition-all text-right font-medium cursor-pointer"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Stage: Generated Images Display Grid */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm min-h-[480px] flex flex-col justify-center relative">
              {isGenerating && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-md z-20 flex flex-col items-center justify-center p-6 text-center rounded-3xl">
                  <div className="w-16 h-16 rounded-3xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 mb-4 animate-bounce">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-black text-slate-900 mb-1">
                    {isHe ? `מעבד ${genCount} תמונות במודל Gemini AI...` : `Generating ${genCount} Images with Gemini AI...`}
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm">
                    {isHe ? 'התמונות נוצרות בזמן אמת ברזולוציה גבוהה. אנא המתן מספר שניות...' : 'Creating high fidelity images live. Please wait a moment...'}
                  </p>
                  <div className="w-48 h-1.5 bg-slate-100 rounded-full mt-4 overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full animate-pulse w-3/4"></div>
                  </div>
                </div>
              )}

              {lastGeneratedBatch.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>{isHe ? 'התמונות שנוצרו במחזור האחרון:' : 'Last Generated Batch:'}</span>
                    </h3>
                    <span className="text-xs text-slate-500 font-medium">{lastGeneratedBatch.length} {isHe ? 'פריטים' : 'items'}</span>
                  </div>

                  <div className={`grid gap-4 ${lastGeneratedBatch.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                    {lastGeneratedBatch.map((item) => (
                      <div key={item.id} className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-md flex flex-col group">
                        <div className="relative aspect-square flex items-center justify-center overflow-hidden">
                          <img src={item.url} alt={item.prompt} className="w-full h-full object-contain" />
                          <button
                            onClick={() => setFullscreenImage(item.url)}
                            className="absolute top-2 left-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          >
                            <Maximize2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Quick actions bar under each image */}
                        <div className="p-3 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              onClick={() => handleOpenInManualEdit(item.url)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title={isHe ? 'ערוך בעורך ידני' : 'Edit Manually'}
                            >
                              <Sliders className="w-3 h-3" />
                              <span>{isHe ? '✏️ ערוך' : 'Edit'}</span>
                            </button>

                            <button
                              onClick={() => handleOpenInAiEdit(item.url)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-purple-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Wand2 className="w-3 h-3" />
                              <span>{isHe ? '✨ AI' : 'AI Edit'}</span>
                            </button>

                            <button
                              onClick={() => handleOpenInFaceSwap(item.url)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <UserCheck className="w-3 h-3" />
                              <span>{isHe ? '🔀 פנים' : 'Face'}</span>
                            </button>

                            <button
                              onClick={() => handleOpenInAnim(item.url)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Film className="w-3 h-3" />
                              <span>{isHe ? '🎬 הנפ' : 'Anim'}</span>
                            </button>
                          </div>

                          <button
                            onClick={() => handleDownloadImage(item.url, 'ai_image')}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-all cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center p-8 max-w-sm mx-auto">
                  <div className="w-16 h-16 rounded-3xl bg-indigo-50 border border-indigo-100 text-indigo-500 flex items-center justify-center mx-auto mb-4">
                    <Palette className="w-8 h-8 opacity-80" />
                  </div>
                  <h3 className="text-sm font-black text-slate-900 mb-1">{isHe ? 'מוכן ליצירה' : 'Ready to Create'}</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    {isHe ? 'בחר פרומפט וכמות תמונות ליצירה במקביל' : 'Select prompt and number of images to generate'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TAB 2: MANUAL IMAGE EDITOR PANEL (imgEditPanel)                    */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'manual-edit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span>{isHe ? 'עורך תמונות ידני (7 פילטרים + חיתוך/סיבוב)' : 'Manual Photo Editor'}</span>
              </h2>

              {/* Upload Drop Area */}
              <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-all">
                <Upload className="w-6 h-6 text-indigo-600" />
                <span className="text-xs font-bold text-slate-700">{isHe ? 'העלאת תמונה לעריכה (או גרירה)' : 'Upload image to edit'}</span>
                <input type="file" accept="image/*" onChange={handleUploadImageForEdit} className="hidden" />
              </label>

              {editImageSrc ? (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{isHe ? 'כיוונון 7 פילטרים:' : 'Adjust 7 Filters:'}</span>
                    <button onClick={resetEditorFilters} className="text-[11px] font-bold text-indigo-600 hover:underline">
                      {isHe ? 'אפס פילטרים' : 'Reset'}
                    </button>
                  </div>

                  {/* 7 Filters Sliders */}
                  <div className="space-y-2 text-xs">
                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'בהירות (Brightness)' : 'Brightness'}</span>
                        <span>{brightness}%</span>
                      </div>
                      <input type="range" min="0" max="200" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'ניגודיות (Contrast)' : 'Contrast'}</span>
                        <span>{contrast}%</span>
                      </div>
                      <input type="range" min="0" max="200" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'רוויה (Saturation)' : 'Saturation'}</span>
                        <span>{saturation}%</span>
                      </div>
                      <input type="range" min="0" max="200" value={saturation} onChange={(e) => setSaturation(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'טשטוש (Blur)' : 'Blur'}</span>
                        <span>{blur}px</span>
                      </div>
                      <input type="range" min="0" max="20" value={blur} onChange={(e) => setBlur(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'שחור-לבן (Grayscale)' : 'Grayscale'}</span>
                        <span>{grayscale}%</span>
                      </div>
                      <input type="range" min="0" max="100" value={grayscale} onChange={(e) => setGrayscale(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'ספיה וינטג\' (Sepia)' : 'Sepia'}</span>
                        <span>{sepia}%</span>
                      </div>
                      <input type="range" min="0" max="100" value={sepia} onChange={(e) => setSepia(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>

                    <div>
                      <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                        <span>{isHe ? 'שינוי גוונים (Hue Rotate)' : 'Hue Rotate'}</span>
                        <span>{hueRotate}°</span>
                      </div>
                      <input type="range" min="0" max="360" value={hueRotate} onChange={(e) => setHueRotate(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>
                  </div>

                  {/* Transformation Controls */}
                  <div className="pt-2 border-t border-slate-200">
                    <span className="block text-xs font-bold text-slate-800 mb-2">{isHe ? 'סיבוב והיפוך:' : 'Rotate & Flip:'}</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        onClick={() => setRotation((r) => (r - 90) % 360)}
                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 flex items-center justify-center cursor-pointer"
                        title={isHe ? 'סובב 90 מעלות שמאלה' : 'Rotate Left'}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setRotation((r) => (r + 90) % 360)}
                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 flex items-center justify-center cursor-pointer"
                        title={isHe ? 'סובב 90 מעלות ימינה' : 'Rotate Right'}
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setFlipH((f) => !f)}
                        className={`p-2 rounded-xl flex items-center justify-center cursor-pointer ${flipH ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                        title={isHe ? 'היפוך אופקי' : 'Flip Horizontally'}
                      >
                        <FlipHorizontal className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setFlipV((f) => !f)}
                        className={`p-2 rounded-xl flex items-center justify-center cursor-pointer ${flipV ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                        title={isHe ? 'היפוך אנכי' : 'Flip Vertically'}
                      >
                        <FlipVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Save Buttons */}
                  <div className="pt-3 flex gap-2">
                    <button
                      onClick={() => handleSaveEditedImage('image/png')}
                      className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer"
                    >
                      {isHe ? 'שמור ב-PNG' : 'Save PNG'}
                    </button>
                    <button
                      onClick={() => handleSaveEditedImage('image/jpeg')}
                      className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer"
                    >
                      {isHe ? 'שמור ב-JPEG' : 'Save JPEG'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center p-6 text-slate-400 text-xs">
                  {isHe ? 'בחר תמונה להעלאה או לחץ על ✏️ ערוך מתחת לתמונה בגלריה' : 'Upload an image or click Edit on any gallery image'}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Canvas Output */}
          <div className="lg:col-span-8 bg-slate-950 rounded-3xl p-4 flex items-center justify-center min-h-[480px] border border-slate-800 shadow-inner">
            {editImageSrc ? (
              <canvas ref={canvasRef} className="max-h-[500px] max-w-full object-contain rounded-2xl shadow-2xl" />
            ) : (
              <div className="text-center text-slate-500 text-sm">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <span>{isHe ? 'העלה תמונה כדי להתחיל בעריכה הידנית' : 'Upload an image to start manual editing'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TAB 3: WEB IMAGE SEARCH (webSearchBox - DuckDuckGo / Openverse)   */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'web-search' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <form onSubmit={handleSearchWebImages} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-5 h-5 absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isHe ? 'חפש תמונות ברשת (DuckDuckGo / Openverse)...' : 'Search web images...'}
                  className="w-full pr-12 pl-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm rounded-2xl shadow-md transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{isHe ? 'חפש תמונות' : 'Search'}</span>
              </button>
            </form>
          </div>

          {/* Search Results Grid */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm min-h-[400px]">
            {isSearching ? (
              <div className="text-center py-16 text-slate-500 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
                <p className="text-sm font-bold">{isHe ? 'מחפש תמונות ברשת...' : 'Searching web images...'}</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {searchResults.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-sm group flex flex-col justify-between"
                  >
                    <div className="aspect-square relative flex items-center justify-center overflow-hidden">
                      <img src={item.thumbnail || item.image} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[9px] font-mono">
                        {item.source}
                      </div>
                    </div>

                    <div className="p-2 bg-slate-900 border-t border-slate-800 flex flex-col gap-1.5">
                      <p className="text-[10px] font-bold text-slate-200 line-clamp-1">{item.title}</p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            addGalleryItem({
                              id: item.id,
                              url: item.image,
                              prompt: item.title,
                              source: 'web-search',
                              createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            });
                            handleOpenInManualEdit(item.image);
                          }}
                          className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg transition-all text-center cursor-pointer"
                        >
                          {isHe ? '✏️ ערוך' : 'Edit'}
                        </button>
                        <button
                          onClick={() => handleDownloadImage(item.image, 'web_search')}
                          className="p-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-slate-400 text-sm">
                <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <span>{isHe ? 'הקלד מילת חיפוש ולחץ על חיפוש' : 'Type a query above to search for images'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TAB 4: AI WORDS EDIT PANEL (aiEditBox)                             */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'ai-edit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-purple-600" />
                <span>{isHe ? 'עריכת AI במילים (הוראה טקסטואלית לתמונה)' : 'AI Words Photo Editing'}</span>
              </h2>

              <label className="border-2 border-dashed border-slate-200 hover:border-purple-400 bg-slate-50 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-all">
                <Upload className="w-6 h-6 text-purple-600" />
                <span className="text-xs font-bold text-slate-700">{isHe ? 'בחר/העלה תמונה לשינוי AI' : 'Upload source image for AI edit'}</span>
                <input type="file" accept="image/*" onChange={handleUploadAiEditSource} className="hidden" />
              </label>

              {aiEditSourceImg && (
                <div className="aspect-video bg-slate-900 rounded-2xl overflow-hidden border border-slate-200">
                  <img src={aiEditSourceImg} alt="Source" className="w-full h-full object-contain" />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">{isHe ? 'הוראת השינוי בעברית/אנגלית:' : 'Editing Instruction:'}</label>
                <textarea
                  value={aiEditInstruction}
                  onChange={(e) => setAiEditInstruction(e.target.value)}
                  placeholder={
                    isHe
                      ? 'לדוגמה: הוסף משקפי שמש ומגבעת קסמים לדמות, הפוך את הרקע לים בשקיעה'
                      : 'e.g., Add sunglasses and a magic hat, change background to sunset ocean'
                  }
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600 resize-none font-medium"
                />
              </div>

              <button
                type="button"
                onClick={handleRunAiEdit}
                disabled={isAiEditing || !aiEditSourceImg || !aiEditInstruction.trim()}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-sm shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isAiEditing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                <span>{isHe ? 'הפעל עריכת AI' : 'Run AI Edit'}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-950 rounded-3xl p-5 flex items-center justify-center min-h-[480px] border border-slate-800 shadow-inner">
            {isAiEditing ? (
              <div className="text-center text-slate-300 space-y-3">
                <Wand2 className="w-10 h-10 animate-bounce mx-auto text-purple-400" />
                <p className="text-sm font-bold">{isHe ? 'מעבד את השינוי בבינה מלאכותית...' : 'Processing AI Image Edit...'}</p>
              </div>
            ) : aiEditedResult ? (
              <div className="w-full flex flex-col items-center gap-3">
                <img src={aiEditedResult} alt="Edited" className="max-h-[450px] w-auto object-contain rounded-2xl shadow-2xl" />
                <button
                  onClick={() => handleDownloadImage(aiEditedResult, 'ai_edited')}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isHe ? 'הורד תמונה ערוכה' : 'Download Edited Image'}</span>
                </button>
              </div>
            ) : (
              <div className="text-center text-slate-500 text-sm">
                <Wand2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <span>{isHe ? 'התוצאה הערוכה תופיע כאן' : 'AI Edited result will appear here'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TAB 5: FACE SWAP PANEL (faceSwapPanel - Local Composite)            */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'face-swap' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-cyan-600" />
                <span>{isHe ? 'החלפת פנים (גוף פיקסל-בפיקסל)' : 'Local Face Swap Composite'}</span>
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">{isHe ? '1. תמונת גוף (יעד):' : '1. Body Image:'}</label>
                  <label className="border-2 border-dashed border-slate-200 hover:border-cyan-400 bg-slate-50 p-3 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all">
                    <Upload className="w-5 h-5 text-cyan-600 mb-1" />
                    <span className="text-[10px] font-bold text-slate-600">{isHe ? 'בחר גוף' : 'Select Body'}</span>
                    <input type="file" accept="image/*" onChange={handleUploadBody} className="hidden" />
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">{isHe ? '2. תמונת פנים (מקור):' : '2. Face Image:'}</label>
                  <label className="border-2 border-dashed border-slate-200 hover:border-cyan-400 bg-slate-50 p-3 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all">
                    <Upload className="w-5 h-5 text-cyan-600 mb-1" />
                    <span className="text-[10px] font-bold text-slate-600">{isHe ? 'בחר פנים' : 'Select Face'}</span>
                    <input type="file" accept="image/*" onChange={handleUploadFace} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Face Controls */}
              {bodyImgSrc && faceImgSrc && (
                <div className="space-y-3 pt-2 text-xs">
                  <div>
                    <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                      <span>{isHe ? 'גודל פנים (Scale)' : 'Face Size'}</span>
                      <span>{Math.round(faceScale * 100)}%</span>
                    </div>
                    <input type="range" min="0.1" max="0.8" step="0.01" value={faceScale} onChange={(e) => setFaceScale(Number(e.target.value))} className="w-full accent-cyan-600" />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                      <span>{isHe ? 'מיקום אופקי (X)' : 'Position X'}</span>
                      <span>{Math.round(faceX * 100)}%</span>
                    </div>
                    <input type="range" min="0.1" max="0.9" step="0.01" value={faceX} onChange={(e) => setFaceX(Number(e.target.value))} className="w-full accent-cyan-600" />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                      <span>{isHe ? 'מיקום אנכי (Y)' : 'Position Y'}</span>
                      <span>{Math.round(faceY * 100)}%</span>
                    </div>
                    <input type="range" min="0.1" max="0.9" step="0.01" value={faceY} onChange={(e) => setFaceY(Number(e.target.value))} className="w-full accent-cyan-600" />
                  </div>

                  <div>
                    <div className="flex justify-between font-bold text-slate-600 mb-0.5">
                      <span>{isHe ? 'זווית סיבוב פנים' : 'Rotation'}</span>
                      <span>{faceRot}°</span>
                    </div>
                    <input type="range" min="-180" max="180" value={faceRot} onChange={(e) => setFaceRot(Number(e.target.value))} className="w-full accent-cyan-600" />
                  </div>

                  <button
                    onClick={handleSaveFaceSwap}
                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    {isHe ? 'שמור תמונת החלפת פנים' : 'Save Face Swapped Image'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-950 rounded-3xl p-4 flex items-center justify-center min-h-[480px] border border-slate-800 shadow-inner">
            {bodyImgSrc ? (
              <canvas ref={faceSwapCanvasRef} className="max-h-[500px] max-w-full object-contain rounded-2xl shadow-2xl" />
            ) : (
              <div className="text-center text-slate-500 text-sm">
                <UserCheck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <span>{isHe ? 'העלה תמונת גוף ופנים להתחלת ההרכבה' : 'Upload body & face images to composite'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TAB 6: ANIMATION PANEL (animPanel - Camera Motion & WebM)         */}
      {/* ----------------------------------------------------------------- */}
      {activeTab === 'anim' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Film className="w-4 h-4 text-emerald-600" />
                <span>{isHe ? 'הנפשת תמונות בזמן אמת (תנועות מצלמה + WebM)' : 'Image Animation & WebM Recording'}</span>
              </h2>

              <label className="border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-all">
                <Upload className="w-6 h-6 text-emerald-600" />
                <span className="text-xs font-bold text-slate-700">{isHe ? 'בחר/העלה תמונה להנפשה' : 'Upload image to animate'}</span>
                <input type="file" accept="image/*" onChange={handleUploadAnimSource} className="hidden" />
              </label>

              {animSourceImg && (
                <div className="space-y-3 pt-2 text-xs">
                  {/* Motion Selector */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">{isHe ? 'תנועת מצלמה:' : 'Camera Motion:'}</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'zoom-in', label: isHe ? '🔍 זום פנימה' : 'Zoom In' },
                        { id: 'zoom-out', label: isHe ? '🔎 זום החוצה' : 'Zoom Out' },
                        { id: 'pan-left', label: isHe ? '⬅️ גלילה שמאלה' : 'Pan Left' },
                        { id: 'pan-right', label: isHe ? '➡️ גלילה ימינה' : 'Pan Right' },
                        { id: 'pan-up', label: isHe ? '⬆️ גלילה למעלה' : 'Pan Up' },
                        { id: 'pan-down', label: isHe ? '⬇️ גלילה למטה' : 'Pan Down' },
                        { id: 'zoom-pan', label: isHe ? '🎬 זום + גלילה' : 'Zoom + Pan' },
                        { id: 'orbit', label: isHe ? '🔄 סיבוב קל' : 'Orbit Wobble' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setAnimMotion(m.id as any)}
                          className={`p-2 rounded-xl border text-center transition-all cursor-pointer font-bold ${
                            animMotion === m.id ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration Selector */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">{isHe ? 'משך הנפשה (שניות):' : 'Duration (seconds):'}</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[2, 3, 5, 8, 10].map((sec) => (
                        <button
                          key={sec}
                          onClick={() => setAnimDuration(sec)}
                          className={`py-1.5 rounded-xl border text-center font-black cursor-pointer ${
                            animDuration === sec ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Resolution Picker */}
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">{isHe ? 'איכות/גודל:' : 'Resolution Size:'}</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'original', label: isHe ? 'מקור' : 'Original' },
                        { id: '720p', label: '720p HD' },
                        { id: '480p', label: '480p SD' },
                      ].map((res) => (
                        <button
                          key={res.id}
                          onClick={() => setAnimResolution(res.id as any)}
                          className={`py-1.5 rounded-xl border text-center font-bold cursor-pointer ${
                            animResolution === res.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      onClick={handleStartRecordWebm}
                      disabled={isAnimRecording}
                      className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isAnimRecording ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>{isHe ? `מקליט וידאו... (${recordingProgress}%)` : `Recording WebM... (${recordingProgress}%)`}</span>
                        </>
                      ) : (
                        <>
                          <Film className="w-4 h-4" />
                          <span>{isHe ? 'הקלט וידאו WebM (30 FPS)' : 'Record WebM Video (30 FPS)'}</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleCaptureAnimFrame}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl border border-slate-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-emerald-600" />
                      <span>{isHe ? 'שמור פריים נוכחי לגלריה' : 'Save Frame to Gallery'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 bg-slate-950 rounded-3xl p-4 flex items-center justify-center min-h-[480px] border border-slate-800 shadow-inner">
            {animSourceImg ? (
              <canvas ref={animCanvasRef} className="max-h-[500px] max-w-full object-contain rounded-2xl shadow-2xl" />
            ) : (
              <div className="text-center text-slate-500 text-sm">
                <Film className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <span>{isHe ? 'העלה תמונה כדי לראות הנפשה חיה' : 'Upload image to see live motion'}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* UNIFIED GALLERY SECTION (Always visible below active panel)         */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-purple-600" />
            <span>{isHe ? 'גלריית תמונות מאוחדת (נוצרו / נערו) :' : 'Unified Gallery:'}</span>
          </h2>
          {gallery.length > 0 && (
            <button
              onClick={() => {
                if (confirm(isHe ? 'למחוק את כל הגלריה?' : 'Clear gallery?')) setGallery([]);
              }}
              className="text-xs text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isHe ? 'נקה גלריה' : 'Clear Gallery'}</span>
            </button>
          )}
        </div>

        {gallery.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {gallery.map((item) => (
              <div key={item.id} className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-sm flex flex-col group">
                <div className="aspect-square relative flex items-center justify-center overflow-hidden">
                  <img src={item.url} alt={item.prompt} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  <button
                    onClick={() => setFullscreenImage(item.url)}
                    className="absolute top-2 left-2 p-1.5 bg-black/60 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-2 bg-slate-900 border-t border-slate-800 flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold text-slate-200 line-clamp-1">{item.prompt}</p>

                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <button
                      onClick={() => handleOpenInManualEdit(item.url)}
                      className="py-1 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white rounded-md font-bold transition-all text-center cursor-pointer"
                    >
                      {isHe ? '✏️ ערוך' : 'Edit'}
                    </button>

                    <button
                      onClick={() => handleOpenInAiEdit(item.url)}
                      className="py-1 bg-slate-800 hover:bg-purple-600 text-slate-200 hover:text-white rounded-md font-bold transition-all text-center cursor-pointer"
                    >
                      {isHe ? '✨ AI' : 'AI'}
                    </button>

                    <button
                      onClick={() => handleOpenInFaceSwap(item.url)}
                      className="py-1 bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white rounded-md font-bold transition-all text-center cursor-pointer"
                    >
                      {isHe ? '🔀 פנים' : 'Swap'}
                    </button>

                    <button
                      onClick={() => handleOpenInAnim(item.url)}
                      className="py-1 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-md font-bold transition-all text-center cursor-pointer"
                    >
                      {isHe ? '🎬 הנפ' : 'Anim'}
                    </button>
                  </div>

                  <div className="flex justify-between items-center pt-1 border-t border-slate-800/60">
                    <button
                      onClick={() => handleDownloadImage(item.url, 'gallery_img')}
                      className="p-1 text-slate-400 hover:text-white transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => removeGalleryItem(item.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400 text-xs">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <span>{isHe ? 'הגלריה ריקה כרגע. תמונות שתיצור, שתערוך או שתחפש יופיעו כאן' : 'Gallery is currently empty.'}</span>
          </div>
        )}
      </div>

      {/* Fullscreen Zoom Modal */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-lg flex items-center justify-center p-4"
          >
            <button
              onClick={() => setFullscreenImage(null)}
              className="absolute top-5 right-5 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img src={fullscreenImage} alt="Fullscreen" className="max-h-[90vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
