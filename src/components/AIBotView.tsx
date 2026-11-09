import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Play,
  Film,
  BookOpen,
  Code,
  Music,
  ExternalLink,
  Star,
  RotateCcw,
} from 'lucide-react';
import { motion } from 'motion/react';

import { BotMessage, Language, EngineMode, JamendoTrack, ArchiveItem } from '../types';
import { askWikiArchiveBot } from '../services/aiService';
import { AudioTTSPlayer } from './AudioTTSPlayer';
import { AIModelType } from '../services/aiProviders';

interface AIBotViewProps {
  lang: Language;
  engineMode: EngineMode;
  onPlayMedia: (item: ArchiveItem) => void;
  onPlayTrack: (track: JamendoTrack) => void;
  onBookmark: (title: string, summary: string, url: string, type: 'bot_answer', extra?: any) => void;
}

export const AIBotView: React.FC<AIBotViewProps> = ({
  lang,
  engineMode,
  onPlayMedia,
  onPlayTrack,
  onBookmark,
}) => {
  const isHe = lang === 'he';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [aiModel, setAiModel] = useState<AIModelType>('perchance');

  const [messages, setMessages] = useState<BotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: isHe
        ? `שלום! אני **WikiArchive AI** - עוזר הבינה המלאכותית הפועל באמצעות **Perchance AI** ו-**Pollinations.ai** ומחובר ישירות ל-8 מאגרי מידע פתוחים:
**ויקיפדיה • Internet Archive • Gutenberg • Open Library • MusicBrainz • ארכיון המוזיקה • Openverse • GitHub**

שאל אותי על כל נושא, היסטוריה, קוד, ספרות, מדע או מוזיקה - ואענה לך בלייב עם אפשרות להקראה קולית!`
        : `Welcome! I am **WikiArchive AI** - powered by **Perchance AI** & **Pollinations.ai** across 8 open knowledge repositories! Ask me anything!`,
      timestamp: new Date(),
      suggestedQuestions: isHe
        ? [
            'פרויקטי React ו-TypeScript ב-GitHub',
            'ספרי Sherlock Holmes ב-Gutenberg',
            'מסע בחלל ונחיתה על הירח 1969',
            'מוזיקת אמביאנט וג’אז ב-Jamendo',
          ]
        : [
            'Top React repositories on GitHub',
            'Sherlock Holmes ebooks in Gutenberg',
            'Apollo 11 Moon Landing Video Archive',
            'Ambient music in Jamendo',
          ],
    },
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, currentStep]);

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || loading) return;

    const newUserMsg: BotMessage = {
      id: 'user-' + Date.now(),
      role: 'user',
      text: textToSend.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newUserMsg]);
    setInputQuery('');
    setLoading(true);

    setCurrentStep(isHe ? '🔍 סורק בויקיפדיה, GitHub ו-Internet Archive...' : '🔍 Searching Wikipedia, GitHub & Archive...');
    await new Promise((r) => setTimeout(r, 600));

    setCurrentStep(isHe ? '🧠 מסנתז תשובה...' : '🧠 Synthesizing AI response...');

    try {
      const result = await askWikiArchiveBot(textToSend, lang, engineMode);

      const newBotMsg: BotMessage = {
        id: 'bot-' + Date.now(),
        role: 'assistant',
        text: result.text,
        timestamp: new Date(),
        wikiItems: result.wikiItems,
        archiveItems: result.archiveItems,
        gutenbergBooks: result.gutenbergBooks,
        jamendoTracks: result.jamendoTracks,
        githubRepos: result.githubRepos,
        suggestedQuestions: result.suggestedQuestions,
      };

      setMessages((prev) => [...prev, newBotMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: 'error-' + Date.now(),
          role: 'assistant',
          text: isHe ? 'אירעה שגיאה בעיבוד התשובה.' : 'An error occurred.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setCurrentStep('');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] max-w-5xl mx-auto p-3 sm:p-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 mb-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3 space-x-reverse">
          <div className="w-10 h-10 rounded-2xl bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-600 shadow-sm">
            <Bot className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
              <span>{isHe ? 'צאט בינה מלאכותית' : 'AI Chat Assistant'}</span>
              <span className="px-2.5 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded-full font-bold border border-purple-200">
                🎲 Perchance AI Engine
              </span>
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              {isHe ? 'תשובות חכמות ודיבוב קולי בזמן אמת מחובר ל-8 מאגרי מידע פתוחים' : 'Powered by Perchance AI with live audio voiceover'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setMessages([])}
          className="px-3 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all border border-slate-200 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{isHe ? 'שיחה חדשה' : 'New Chat'}</span>
        </button>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto space-y-4 px-1 pr-2 custom-scrollbar">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex space-x-3 space-x-reverse ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-2xl bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-600 flex-shrink-0 mt-1 shadow-sm">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-2xl rounded-3xl p-5 shadow-sm border transition-all ${
                  isUser
                    ? 'bg-indigo-600 text-white border-indigo-600 rounded-tl-none font-medium'
                    : 'bg-white border-slate-200 text-slate-900 rounded-tr-none'
                }`}
              >
                <div className="prose prose-slate max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </div>

                {/* Voiceover for Bot Answer */}
                {!isUser && msg.text && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                    <AudioTTSPlayer
                      text={msg.text}
                      label={isHe ? 'האזן לתשובה בקול' : 'Listen to answer'}
                    />
                    <span className="text-[10px] text-purple-600 font-mono font-bold bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200/60">
                      🎲 Perchance AI
                    </span>
                  </div>
                )}

                {/* Attachments inside Bot Answer */}
                {msg.githubRepos && msg.githubRepos.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-200/80">
                    <h4 className="text-xs font-bold text-purple-700 mb-2 flex items-center gap-1.5">
                      <Code className="w-4 h-4 text-purple-600" />
                      <span>{isHe ? 'פרויקטי קוד ב-GitHub:' : 'GitHub Repos:'}</span>
                    </h4>
                    <div className="space-y-2">
                      {msg.githubRepos.map((repo) => (
                        <div key={repo.id} className="bg-slate-50 border border-slate-200 p-2.5 rounded-2xl flex items-center justify-between">
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-xs text-slate-900 block truncate">{repo.fullName}</span>
                            <span className="text-[11px] text-slate-500 truncate block">{repo.description}</span>
                          </div>
                          <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="p-1.5 bg-slate-200 text-slate-800 rounded-xl">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isUser && msg.suggestedQuestions && (
                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap gap-1.5">
                      {msg.suggestedQuestions.map((sq, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(sq)}
                          className="px-3 py-1 text-xs bg-slate-100 hover:bg-indigo-50 text-indigo-700 border border-slate-200 rounded-full font-bold transition-all"
                        >
                          + {sq}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-8 h-8 rounded-2xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                  <User className="w-4 h-4" />
                </div>
              )}
            </motion.div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-3 p-3 bg-white border border-indigo-200 rounded-2xl max-w-sm shadow-sm">
            <Sparkles className="w-4 h-4 text-indigo-600 animate-spin" />
            <p className="text-xs font-bold text-indigo-700">{currentStep}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="mt-3 pt-2 border-t border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="relative flex items-center"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={isHe ? 'שאל את הבוט על כל נושא...' : 'Ask the AI bot...'}
            className="w-full pr-12 pl-12 py-3.5 bg-white border border-slate-300 focus:border-indigo-600 rounded-2xl text-slate-900 text-sm font-medium focus:outline-none shadow-md"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || loading}
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 p-2.5 rounded-xl text-white font-bold transition-all ${
              inputQuery.trim() && !loading ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 text-slate-500'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
