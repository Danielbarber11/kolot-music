import React, { useState, useEffect, useRef } from 'react';
import { Network, Sparkles, Play, ExternalLink, RefreshCw } from 'lucide-react';
import { KnowledgeNode, Language, ArchiveItem } from '../types';

interface KnowledgeGraphViewProps {
  lang: Language;
  onPlayMedia: (item: ArchiveItem) => void;
  onAskBotAbout: (topic: string) => void;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  lang,
  onPlayMedia,
  onAskBotAbout,
}) => {
  const isHe = lang === 'he';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [nodes, setNodes] = useState<KnowledgeNode[]>([
    {
      id: 'apollo',
      label: isHe ? 'מסע בחלל ואפולו 11' : 'Apollo 11 & Space',
      type: 'topic',
      x: 350,
      y: 200,
      color: '#6366f1',
      connections: ['moon_landing_video', 'einstein_relativity', 'nasa_archive'],
      details: isHe ? 'התפתחויות במדעי החלל ותכנית אפולו 1969' : 'Space Exploration & NASA Apollo 11 Lunar Landing',
    },
    {
      id: 'moon_landing_video',
      label: isHe ? '🎥 וידיאו: נחיתה על הירח 1969' : '🎥 Video: Lunar Landing 1969',
      type: 'archive',
      x: 180,
      y: 120,
      color: '#ec4899',
      connections: ['apollo'],
      mediaType: 'movies',
      identifier: 'Apollo11Moonlanding',
    },
    {
      id: 'einstein_relativity',
      label: isHe ? '📖 איינשטיין ותורת היחסות' : '📖 Einstein Relativity',
      type: 'wiki',
      x: 550,
      y: 140,
      color: '#f59e0b',
      connections: ['apollo', 'physics_papers'],
      details: isHe ? 'מאמרי היסוד של אלברט איינשטיין מ-1915' : 'Foundational relativity theory documents by Einstein',
    },
    {
      id: 'physics_papers',
      label: isHe ? '📚 מסמכי פיזיקה שמורים 1920' : '📚 Scanned Physics Books 1920',
      type: 'archive',
      x: 680,
      y: 260,
      color: '#10b981',
      connections: ['einstein_relativity'],
      mediaType: 'texts',
      identifier: 'RelativityByAlbertEinstein',
    },
    {
      id: 'computer_history',
      label: isHe ? 'היסטוריית תעשיית המחשבים' : 'Computer Revolution',
      type: 'topic',
      x: 300,
      y: 380,
      color: '#8b5cf6',
      connections: ['apollo', 'msdos_games', 'computing_video'],
    },
    {
      id: 'computing_video',
      label: isHe ? '🎥 וידיאו: עידן המיקרו-מעבדים' : '🎥 Video: Microprocessor Birth',
      type: 'archive',
      x: 120,
      y: 340,
      color: '#ec4899',
      connections: ['computer_history'],
      mediaType: 'movies',
      identifier: 'computer_history_museum_demo',
    },
    {
      id: 'msdos_games',
      label: isHe ? '🎮 משחקי MS-DOS רטרו' : '🎮 Arcade Games MS-DOS',
      type: 'archive',
      x: 480,
      y: 420,
      color: '#06b6d4',
      connections: ['computer_history'],
      mediaType: 'software',
      identifier: 'msdos_Pac-Man_1983',
    },
    {
      id: 'nasa_archive',
      label: isHe ? '🌐 ארכיון התמונות של נאס"א' : '🌐 NASA Photo Archive',
      type: 'archive',
      x: 520,
      y: 280,
      color: '#3b82f6',
      connections: ['apollo'],
    },
  ]);

  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(nodes[0]);

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Connection Lines
      nodes.forEach((node) => {
        node.connections.forEach((targetId: string) => {
          const target = nodes.find((n) => n.id === targetId);
          if (target) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
      });

      // Draw Nodes
      nodes.forEach((node) => {
        const isSelected = selectedNode?.id === node.id;

        // Glowing aura
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 24, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
          ctx.fill();
        }

        // Main Node Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, isSelected ? 16 : 12, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isSelected ? 3 : 1;
        ctx.stroke();

        // Node Label
        ctx.font = '11px sans-serif';
        ctx.fillStyle = isSelected ? '#ffffff' : '#cbd5e1';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y + 28);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [nodes, selectedNode]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const clicked = nodes.find((n) => {
      const dist = Math.hypot(n.x - clickX, n.y - clickY);
      return dist <= 20;
    });

    if (clicked) {
      setSelectedNode(clicked);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Network className="w-6 h-6 text-indigo-400" />
              <span>{isHe ? 'גרף ידע קוונטי (Knowledge Graph)' : 'Interactive Knowledge Graph'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {isHe
                ? 'מפה אינטראקטיבית המחברת בין נושאי ויקיפדיה, סרטוני ארכיון ומסמכי מקור'
                : 'Interactive visual node system connecting Wikipedia concepts with Internet Archive primary media.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
            <span className="text-xs text-slate-400">{isHe ? 'נושא' : 'Topic'}</span>
            <span className="w-3 h-3 rounded-full bg-pink-500 inline-block ml-2" />
            <span className="text-xs text-slate-400">{isHe ? 'סרטון ארכיון' : 'Video'}</span>
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block ml-2" />
            <span className="text-xs text-slate-400">{isHe ? 'ערך ויקיפדיה' : 'Wikipedia'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canvas Box */}
          <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl relative overflow-hidden h-[420px] flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={800}
              height={420}
              onClick={handleCanvasClick}
              className="w-full h-full cursor-pointer"
            />
            <p className="absolute bottom-2 right-3 text-[10px] text-slate-500">
              {isHe ? 'לחץ על הצמתים במפה להרחבה' : 'Click nodes to examine connection'}
            </p>
          </div>

          {/* Node Inspector Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            {selectedNode ? (
              <div>
                <span
                  className="inline-block px-2 py-0.5 text-[10px] font-mono rounded font-semibold text-white mb-3"
                  style={{ backgroundColor: selectedNode.color }}
                >
                  {selectedNode.type.toUpperCase()}
                </span>

                <h3 className="text-lg font-bold text-white leading-tight mb-2">
                  {selectedNode.label}
                </h3>

                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  {selectedNode.details || (isHe ? 'צומת מקושר בגרף הידע' : 'Connected entity in knowledge graph')}
                </p>

                {selectedNode.identifier && (
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl mb-4">
                    <p className="text-[11px] text-indigo-300 font-mono font-semibold">
                      Archive Identifier: {selectedNode.identifier}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center py-10">{isHe ? 'בחר צומת במפה' : 'Select a node on the canvas'}</p>
            )}

            {selectedNode && (
              <div className="space-y-2 pt-4 border-t border-slate-800">
                {selectedNode.identifier && (
                  <button
                    onClick={() =>
                      onPlayMedia({
                        identifier: selectedNode.identifier!,
                        title: selectedNode.label,
                        mediaType: selectedNode.mediaType || 'movies',
                        itemUrl: `https://archive.org/details/${selectedNode.identifier}`,
                      })
                    }
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{isHe ? 'נגן מדיה מקושרת' : 'Play Linked Media'}</span>
                  </button>
                )}

                <button
                  onClick={() => onAskBotAbout(selectedNode.label)}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border border-slate-700"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>{isHe ? 'שאל את בוט ה-AI על צומת זה' : 'Ask AI Bot About Node'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
