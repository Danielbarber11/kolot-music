import React, { useState } from 'react';
import { X, ShieldAlert, Check, FileText, Upload, Paperclip, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, TrackReport, Language } from '../types';
import { saveTrackReportToR2, getCurrentAuthUser, getAuthHeaders } from '../services/authService';
import { TrackCoverArt } from './TrackCoverArt';

interface ReportSongModalProps {
  track: JamendoTrack | null;
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

export const ReportSongModal: React.FC<ReportSongModalProps> = ({
  track,
  isOpen,
  onClose,
  lang,
}) => {
  if (!isOpen || !track) return null;
  const isHe = lang === 'he';

  const currentUser = getCurrentAuthUser();
  const [reason, setReason] = useState(isHe ? 'הפרת זכויות יוצרים' : 'Copyright Infringement');
  const [reporterEmailInput, setReporterEmailInput] = useState(currentUser?.email || '');
  const [details, setDetails] = useState('');
  const [legalDocFile, setLegalDocFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const reportReasons = [
    {
      id: 'הפרת זכויות יוצרים',
      label: isHe ? 'הפרת זכויות יוצרים / תוכן ללא היתר' : 'Copyright Infringement',
      desc: isHe ? 'שיר שהועלה ללא אישור מהיוצר או מבעלי הזכויות' : 'Uploaded without artist permission',
    },
    {
      id: 'איכות שמע פגומה',
      label: isHe ? 'איכות שמע פגומה או קובץ שבור' : 'Poor Audio Quality',
      desc: isHe ? 'קובץ שמע קטוע, רעשים חזקים או לא מתנגן' : 'Corrupted or broken audio file',
    },
    {
      id: 'תוכן פוגעני',
      label: isHe ? 'תוכן פוגעני או בלתי הולם' : 'Inappropriate Content',
      desc: isHe ? 'מילים פוגעניות, השפלה או שפה בלתי הולמת' : 'Offensive language or harmful content',
    },
    {
      id: 'פרטים שגויים',
      label: isHe ? 'פרטי שיר או אמן שגויים' : 'Incorrect Track Info',
      desc: isHe ? 'שם השיר, האמן או העטיפה אינם נכונים' : 'Song title or artist name is incorrect',
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    const authUser = getCurrentAuthUser();
    const resolvedReporterEmail = (authUser?.email || reporterEmailInput || '').trim();

    let legalDocumentKey: string | undefined;
    let legalDocumentName: string | undefined;

    if (reason === 'הפרת זכויות יוצרים' && legalDocFile) {
      try {
        const fd = new FormData();
        fd.append('file', legalDocFile);
        const docRes = await fetch('/api/storage/legal-doc', {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: fd,
        });
        const docData = await docRes.json().catch(() => null);
        if (!docRes.ok || !docData?.key) {
          throw new Error(
            docData?.error || (isHe ? 'העלאת המסמך המשפטי נכשלה' : 'Failed to upload legal document')
          );
        }
        legalDocumentKey = docData.key;
        legalDocumentName = docData.fileName || legalDocFile.name;
      } catch (err: any) {
        setSubmitError(err?.message || (isHe ? 'שגיאה בהעלאת המסמך המשפטי' : 'Legal document upload error'));
        setIsSubmitting(false);
        return;
      }
    }

    const report: TrackReport = {
      id: `report_${Date.now()}`,
      trackId: track.id,
      trackName: track.name,
      artistName: track.artistName,
      reason,
      details: details.trim() || undefined,
      reportedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: 'pending',
      reporterUid: authUser?.uid,
      reporterEmail: resolvedReporterEmail || undefined,
      uploadedByUid: track.uploadedByUid,
      legalDocumentKey,
      legalDocumentName,
    };

    // Save to Cloudflare R2 backend + in-app admin inbox + kolot-music@googlegroups.com (no email sent back to reporter)
    const senderLabel = resolvedReporterEmail || authUser?.displayName || 'משתמש מהאפליקציה';
    const subjectLine = `דיווח על שיר (${reason}): ${track.name} - ${track.artistName}`;
    const bodyDetails =
      `נושא: ${subjectLine}\n` +
      `סיבת הדיווח: ${reason}\n` +
      `שיר: ${track.name} (ID: ${track.id})\n` +
      `אמן: ${track.artistName}` +
      `${resolvedReporterEmail ? `\nמייל מפרסם הדיווח: ${resolvedReporterEmail}` : ''}` +
      `${legalDocumentName ? `\nמסמך משפטי להסרה: ${legalDocumentName}` : ''}` +
      `${details.trim() ? `\nפירוט: ${details.trim()}` : ''}`;

    const [, contactResult] = await Promise.allSettled([
      saveTrackReportToR2(report),
      fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          category: reason === 'הפרת זכויות יוצרים' ? 'copyright' : 'complaint',
          senderContact: senderLabel,
          reporterEmail: resolvedReporterEmail,
          trackId: track.id,
          trackName: track.name,
          artistName: track.artistName,
          uploadedByUid: track.uploadedByUid || '',
          subject: subjectLine,
          message: bodyDetails,
          legalDocumentKey,
          legalDocumentName,
        }),
      }).then((r) => r.json().catch(() => null)),
    ]);

    const dispatchedByServer =
      contactResult.status === 'fulfilled' && Boolean(contactResult.value?.emailDispatched);
    if (!dispatchedByServer) {
      void fetch(`https://formsubmit.co/ajax/${encodeURIComponent('kolot-music@googlegroups.com')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: 'noreply@kolot-music.app',
          _replyto: 'noreply@kolot-music.app',
          name: senderLabel,
          reporter_email: resolvedReporterEmail || 'לא סופק',
          category: reason,
          subject: subjectLine,
          message: bodyDetails,
          legal_document: legalDocumentName || 'ללא',
          full_details: bodyDetails,
          _subject: `[Kolot Music - דיווח שיר] ${subjectLine}`,
          _captcha: 'false',
          _template: 'table',
        }),
      }).catch(() => {});
    }

    setIsSubmitting(false);
    setLegalDocFile(null);
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      onClose();
    }, 2200);
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[160] w-full h-[100dvh] bg-white text-black flex flex-col justify-between overflow-y-auto custom-scrollbar animate-fadeIn"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        {/* CONTAINER */}
        <div className="w-full max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10 flex-1 flex flex-col justify-between space-y-8">
          {/* HEADER */}
          <div className="flex items-center justify-between pb-6 border-b border-neutral-200">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-neutral-900 tracking-tight">
                  {isHe ? 'דיווח על שיר בפלטפורמה' : 'Report Song'}
                </h1>
                <p className="text-xs text-neutral-500 font-medium">
                  {isHe
                    ? 'עזור לנו לשמור על קהילת מוזיקה איכותית, בטוחה והוגנת לכולם'
                    : 'Help us maintain a safe, fair, and clean music community.'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-neutral-100 hover:bg-neutral-200 text-black flex items-center justify-center transition-colors cursor-pointer shadow-sm border border-neutral-200"
              title={isHe ? 'סגור' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* TRACK INFO CARD */}
          <div className="p-4 sm:p-5 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center gap-4 shadow-sm">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden shrink-0 border border-neutral-300 shadow-md">
              <TrackCoverArt
                coverUrl={track.coverUrl}
                artistName={track.artistName}
                trackName={track.name}
                genre={track.genre}
                showHoverPlay={false}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-bold text-neutral-500 block uppercase tracking-wider">
                {isHe ? 'השיר המדווח' : 'Reported Song'}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-neutral-900 truncate mt-0.5">
                {track.name}
              </h2>
              <p className="text-xs font-semibold text-rose-600 truncate mt-0.5">
                {track.artistName}
              </p>
            </div>
          </div>

          {/* SUCCESS MESSAGE */}
          {isSubmitted ? (
            <div className="p-8 rounded-3xl bg-neutral-100 border border-neutral-300 text-neutral-900 text-center space-y-3 animate-fadeIn my-auto">
              <div className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center mx-auto shadow-lg">
                <Check className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-extrabold">
                {isHe ? 'הדיווח התקבל בהצלחה!' : 'Report Submitted!'}
              </h3>
              <p className="text-xs text-neutral-700 max-w-md mx-auto leading-relaxed">
                {isHe
                  ? 'תודה רבה על העזרה. הדיווח הועבר לצוות הניהול לבדיקה וטיפול מהיר.'
                  : 'Thank you for helping. Our team will review this track promptly.'}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 flex-1 flex flex-col justify-between">
              {/* REASON SELECTION */}
              <div className="space-y-3">
                <label className="block text-xs font-extrabold text-neutral-800 uppercase tracking-wider">
                  {isHe ? '1. בחר את סיבת הדיווח *' : '1. Select Reason *'}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {reportReasons.map((r) => {
                    const isSelected = reason === r.id;
                    return (
                      <div
                        key={r.id}
                        onClick={() => setReason(r.id)}
                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-black bg-neutral-900 text-white shadow-lg'
                            : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-900'
                        }`}
                      >
                        <div>
                          <h4 className="font-bold text-sm">{r.label}</h4>
                          <p className={`text-xs mt-1 ${isSelected ? 'text-white/70' : 'text-neutral-500'}`}>
                            {r.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {!currentUser?.email && (
                <div className="space-y-2">
                  <label className="block text-xs font-extrabold text-neutral-800 uppercase tracking-wider">
                    {isHe ? '2. כתובת המייל שלך (אופציונלי — מוצגת למנהל בדיווח)' : '2. Your Email (Optional — visible to admin in report)'}
                  </label>
                  <input
                    type="email"
                    dir="ltr"
                    value={reporterEmailInput}
                    onChange={(e) => setReporterEmailInput(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-300 text-black placeholder-neutral-400 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-black focus:bg-white transition-all"
                  />
                </div>
              )}

              {/* LEGAL DOCUMENT UPLOAD FOR COPYRIGHT INFRINGEMENT */}
              {reason === 'הפרת זכויות יוצרים' && (
                <div className="space-y-2 p-4 rounded-2xl bg-neutral-100 border border-neutral-300">
                  <label className="block text-xs font-extrabold text-neutral-900">
                    {isHe
                      ? 'העלאת מסמך משפטי המוכיח שהשיר שייך לך (לצורך הסרה מהפלטפורמה)'
                      : 'Upload Legal Document Proving Ownership (for song removal)'}
                  </label>
                  <p className="text-[11px] text-neutral-600">
                    {isHe
                      ? 'ניתן לצרף תעודת זכויות יוצרים, אישור אקו״ם/פדרציה, חוזה או מסמך משפטי חתום (PDF, תמונה או Word, עד 10MB). המסמך גלוי למנהל המערכת בלבד.'
                      : 'Attach copyright certificate, signed affidavit, or legal proof (PDF, Image, Word, up to 10MB). Visible to platform admin only.'}
                  </p>
                  {legalDocFile ? (
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white border border-neutral-300 text-xs font-semibold text-neutral-900">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="w-4 h-4 text-neutral-700 shrink-0" />
                        <span className="truncate">{legalDocFile.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLegalDocFile(null)}
                        className="p-1 rounded-full hover:bg-neutral-200 text-neutral-600 hover:text-black cursor-pointer shrink-0"
                        title={isHe ? 'הסר מסמך' : 'Remove document'}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-neutral-50 border-2 border-dashed border-neutral-400 text-xs font-bold text-neutral-800 cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>{isHe ? 'בחר קובץ מסמך משפטי להעלאה' : 'Choose Legal Document File'}</span>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          if (file.size > 10 * 1024 * 1024) {
                            setSubmitError(
                              isHe ? 'הקובץ גדול מ-10MB. נא לבחור קובץ קטן יותר.' : 'File size exceeds 10MB.'
                            );
                            return;
                          }
                          setSubmitError(null);
                          setLegalDocFile(file);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}

              {/* DETAILS TEXTAREA */}
              <div className="space-y-2">
                <label className="block text-xs font-extrabold text-neutral-800 uppercase tracking-wider">
                  {!currentUser?.email
                    ? (isHe ? '3. פירוט נוסף (אופציונלי)' : '3. Additional Details (Optional)')
                    : (isHe ? '2. פירוט נוסף (אופציונלי)' : '2. Additional Details (Optional)')}
                </label>
                <textarea
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={
                    isHe
                      ? 'תוכל להוסיף הסבר קצר או קישור שסייע לצוות הניהול לבדוק את הפנייה...'
                      : 'Provide additional details or links to help us investigate...'
                  }
                  className="w-full px-4 py-3 rounded-2xl bg-neutral-50 border border-neutral-300 text-black placeholder-neutral-400 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-black focus:bg-white transition-all"
                />
              </div>

              {submitError && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* SUBMIT BUTTON */}
              <div className="pt-4 border-t border-neutral-200">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 rounded-2xl bg-black hover:bg-neutral-800 text-white font-extrabold text-sm sm:text-base transition-transform active:scale-[0.99] cursor-pointer shadow-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <FileText className="w-5 h-5 text-white" />
                  <span>
                    {isSubmitting
                      ? isHe
                        ? 'שולח דיווח למנהל...'
                        : 'Submitting...'
                      : isHe
                      ? 'שלח דיווח לצוות הניהול'
                      : 'Submit Report to Admin'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AnimatePresence>
  );
};
