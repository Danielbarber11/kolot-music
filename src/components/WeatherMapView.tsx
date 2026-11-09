import React, { useState, useEffect, useRef } from 'react';
import {
  CloudSun,
  Search,
  Wind,
  Droplets,
  MapPin,
  ExternalLink,
  Compass,
  Thermometer,
  Gauge,
  CloudRain,
  Eye,
  Sun,
  Calendar,
  Clock,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Volume2,
  VolumeX,
  Map as MapIcon,
  Layers,
  ChevronDown,
  RefreshCw,
  Sunset,
  Sunrise,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CityWeather,
  POPULAR_CITIES,
  fetchCityWeather,
  searchCitiesGeocoding,
  getWeatherConditionText,
  getAqiStatusText,
} from '../services/weatherService';
import { Language } from '../types';

interface WeatherMapViewProps {
  lang: Language;
  onBack?: () => void;
}

export const WeatherMapView: React.FC<WeatherMapViewProps> = ({ lang, onBack }) => {
  const isHe = lang === 'he';

  const [selectedCity, setSelectedCity] = useState(POPULAR_CITIES[0]);
  const [weatherData, setWeatherData] = useState<CityWeather | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [graphMode, setGraphMode] = useState<'temp' | 'wind' | 'humidity' | 'rain'>('temp');
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [isSoundMuted, setIsSoundMuted] = useState(true);

  // Geocoding city search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { city: string; country: string; lat: number; lon: number }[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);

  // Canvas weather animation ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const loadWeather = async (cityItem = selectedCity) => {
    setLoading(true);
    try {
      const data = await fetchCityWeather(cityItem);
      setWeatherData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeather(selectedCity);
  }, [selectedCity]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length >= 2) {
        setIsSearching(true);
        const res = await searchCitiesGeocoding(searchQuery);
        setSearchResults(res);
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSearchResult = (c: { city: string; country: string; lat: number; lon: number }) => {
    setSelectedCity(c);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Living Canvas Weather Particles Simulation (Rain, Snow, Clouds, Sunbeams)
  useEffect(() => {
    if (!canvasRef.current || !weatherData) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvasRef.current) return;
      width = canvasRef.current.width = window.innerWidth;
      height = canvasRef.current.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const conditionCode = weatherData.conditionCode;
    const isRain = (conditionCode >= 51 && conditionCode <= 67) || (conditionCode >= 80 && conditionCode <= 82);
    const isSnow = conditionCode >= 71 && conditionCode <= 77;
    const isThunder = conditionCode >= 95;

    // Particle setup
    const particleCount = isRain ? 140 : isSnow ? 100 : 35;
    const particles: Array<{
      x: number;
      y: number;
      length: number;
      speed: number;
      size: number;
      opacity: number;
    }> = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        length: isRain ? 12 + Math.random() * 18 : 2,
        speed: isRain ? 16 + Math.random() * 12 : isSnow ? 1.5 + Math.random() * 2.5 : 0.4 + Math.random() * 0.8,
        size: isSnow ? 2 + Math.random() * 3 : 1.5,
        opacity: 0.2 + Math.random() * 0.5,
      });
    }

    let lightningFlash = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Thunder flash
      if (isThunder && Math.random() < 0.008) {
        lightningFlash = 0.4;
      }
      if (lightningFlash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${lightningFlash})`;
        ctx.fillRect(0, 0, width, height);
        lightningFlash -= 0.04;
      }

      // Draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.save();

        if (isRain) {
          ctx.strokeStyle = `rgba(186, 230, 253, ${p.opacity})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 2, p.y + p.length);
          ctx.stroke();

          p.y += p.speed;
          p.x -= 1.5;
          if (p.y > height) {
            p.y = -20;
            p.x = Math.random() * width;
          }
        } else if (isSnow) {
          ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();

          p.y += p.speed;
          p.x += Math.sin(p.y * 0.02) * 1.2;
          if (p.y > height) {
            p.y = -10;
            p.x = Math.random() * width;
          }
        } else {
          // Floating gentle atmospheric motes / sun dust
          ctx.fillStyle = `rgba(254, 240, 138, ${p.opacity * 0.35})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          ctx.fill();

          p.y -= p.speed;
          p.x += Math.sin(p.y * 0.01) * 0.5;
          if (p.y < 0) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
        }

        ctx.restore();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [weatherData]);

  // OpenStreetMap embed URL
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${selectedCity.lon - 0.08}%2C${selectedCity.lat - 0.05}%2C${selectedCity.lon + 0.08}%2C${selectedCity.lat + 0.05}&layer=mapnik&marker=${selectedCity.lat}%2C${selectedCity.lon}`;

  // Atmospheric gradient based on weather code
  const getAtmosphericBackdrop = (code: number = 0, isDaytime = true) => {
    if (!isDaytime) {
      return 'from-[#020617] via-[#090d16] to-[#0f172a]';
    }
    if (code === 0) {
      return 'from-[#0369a1] via-[#0284c7] to-[#0c4a6e]'; // Sunny sky
    } else if (code >= 1 && code <= 3) {
      return 'from-[#1e293b] via-[#334155] to-[#0f172a]'; // Clouds
    } else if (code >= 61 && code <= 65) {
      return 'from-[#0f172a] via-[#1e293b] to-[#020617]'; // Rain
    } else if (code >= 71 && code <= 77) {
      return 'from-[#1e3a8a] via-[#1e40af] to-[#0f172a]'; // Snow
    }
    return 'from-[#075985] via-[#0369a1] to-[#0c4a6e]';
  };

  const aqiInfo = weatherData ? getAqiStatusText(weatherData.aqi) : null;

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto custom-scrollbar bg-gradient-to-b ${
        weatherData ? getAtmosphericBackdrop(weatherData.conditionCode, weatherData.isDaytime) : 'from-[#020617] to-[#0f172a]'
      } text-white flex flex-col`}
    >
      {/* Living Animated Weather Particle Canvas */}
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 opacity-60" />

      {/* FLOATING POPPING BACK BUTTON IN TOP CORNER (רק למעלה בפינה לחצן חזור) */}
      <motion.div
        initial={{ y: -30, opacity: 0, scale: 0.8 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', bounce: 0.25, duration: 0.35 }}
        className="fixed top-5 right-5 sm:right-8 z-50 flex items-center gap-2"
      >
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-xl shadow-2xl transition-all text-xs sm:text-sm font-bold cursor-pointer hover:scale-105 active:scale-95"
          title={isHe ? 'חזור לעמוד הראשי' : 'Back to Home'}
        >
          {isHe ? <ArrowRight className="w-4 h-4 text-sky-400" /> : <ArrowLeft className="w-4 h-4 text-sky-400" />}
          <span>{isHe ? 'חזור' : 'Back'}</span>
        </button>

        {/* Live Map / Satellite Toggle */}
        <button
          onClick={() => setShowLiveMap((prev) => !prev)}
          className={`p-2.5 rounded-full border backdrop-blur-xl shadow-2xl transition-all cursor-pointer ${
            showLiveMap
              ? 'bg-sky-500 text-white border-sky-400'
              : 'bg-slate-900/80 hover:bg-slate-900 text-white/90 border-white/20'
          }`}
          title={isHe ? 'מפת מזג אוויר ורדאר' : 'Weather Map'}
        >
          <MapIcon className="w-4 h-4" />
        </button>
      </motion.div>

      {/* DRIZZLE WEATHER CONTAINER */}
      <div className="relative z-10 max-w-5xl mx-auto w-full px-4 sm:px-8 py-8 space-y-6">
        {/* TOP SEARCH & CITY CHIPS BAR */}
        <div className="pt-2 max-w-md mx-auto w-full space-y-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isHe ? 'חפש עיר בעולם (ירושלים, פריז, ניו יורק)...' : 'Search any city worldwide...'}
              className="w-full pr-11 pl-4 py-2.5 bg-slate-950/70 border border-white/20 focus:border-sky-400 rounded-full text-xs sm:text-sm text-white placeholder-white/50 focus:outline-none backdrop-blur-xl shadow-lg"
            />
            <Search className="w-4 h-4 text-sky-400 absolute right-4 top-1/2 -translate-y-1/2" />

            <AnimatePresence>
              {searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute top-full right-0 left-0 mt-2 bg-slate-900/95 border border-white/20 rounded-2xl shadow-2xl overflow-hidden z-50 divide-y divide-white/10 backdrop-blur-2xl"
                >
                  {searchResults.map((res, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectSearchResult(res)}
                      className="w-full px-4 py-2.5 text-right hover:bg-sky-950/60 transition-colors text-xs font-bold text-white flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-sky-400" />
                        <span>{res.city}</span>
                      </span>
                      <span className="text-[10px] text-white/50">{res.country}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Quick city pills */}
          <div className="flex items-center justify-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {POPULAR_CITIES.slice(0, 6).map((c) => (
              <button
                key={c.city}
                onClick={() => setSelectedCity(c)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                  selectedCity.city === c.city
                    ? 'bg-sky-500 text-white shadow-md border border-sky-300'
                    : 'bg-white/10 hover:bg-white/20 text-white/90 border border-white/15 backdrop-blur-md'
                }`}
              >
                {c.city}
              </button>
            ))}
          </div>
        </div>

        {loading || !weatherData ? (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-10 h-10 animate-spin text-sky-400 mx-auto" />
            <p className="text-sm font-bold text-white/80">{isHe ? 'מעדכן נתוני מזג אוויר חיים...' : 'Loading live weather...'}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ------------------------------------------------------------- */}
            {/* DRIZZLE WEATHER HEADER (CITY, BIG TEMP, CONDITION, FEELS LIKE)  */}
            {/* ------------------------------------------------------------- */}
            <div className="text-center space-y-1 pt-2">
              <div className="flex items-center justify-center gap-2 text-base font-bold text-white/90 drop-shadow">
                <MapPin className="w-4 h-4 text-sky-300" />
                <span>{weatherData.city}, {weatherData.country}</span>
              </div>

              <div className="flex items-baseline justify-center gap-1">
                <span className="text-6xl sm:text-7xl font-black tracking-tight text-white drop-shadow-lg">
                  {weatherData.temp}°
                </span>
                <span className="text-2xl font-bold text-white/80">C</span>
              </div>

              <div className="space-y-0.5">
                <p className="text-base font-black text-sky-200 drop-shadow">
                  {weatherData.condition}
                </p>
                <p className="text-xs text-white/70 font-medium">
                  {isHe ? 'חום מורגש:' : 'Feels like:'} {weatherData.feelsLike}°C • {isHe ? 'מקס׳:' : 'H:'} {weatherData.tempMax}°C • {isHe ? 'מינ׳:' : 'L:'} {weatherData.tempMin}°C
                </p>
              </div>
            </div>

            {/* LIVE MAP OVERLAY IF ACTIVE */}
            {showLiveMap && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-slate-900/85 backdrop-blur-2xl border border-white/20 rounded-3xl p-4 shadow-2xl space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-400" />
                    <span>{isHe ? `מפת OpenStreetMap חיה - ${selectedCity.city}` : `Live Map - ${selectedCity.city}`}</span>
                  </span>
                  <button onClick={() => setShowLiveMap(false)} className="text-xs text-sky-300 hover:underline">
                    {isHe ? 'הסתר מפה' : 'Hide Map'}
                  </button>
                </div>
                <div className="h-[380px] rounded-2xl overflow-hidden border border-white/10 shadow-inner">
                  <iframe src={osmEmbedUrl} title="Map" className="w-full h-full border-0" />
                </div>
              </motion.div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* STACK 1: WEEKLY 7-DAY LISTVIEW (LEFT) + 24H HOURLY GRAPH (RIGHT) */}
            {/* ------------------------------------------------------------- */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {/* Left Card: 7-Day Daily Forecast ListView */}
              <div className="md:col-span-5 bg-slate-900/70 border border-white/15 rounded-3xl p-4 backdrop-blur-xl shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
                  <span className="text-xs font-black text-white/90 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-sky-400" />
                    <span>{isHe ? 'תחזית שבועית (7 ימים)' : '7-Day Forecast'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">{isHe ? 'מקס / מינ' : 'Max / Min'}</span>
                </div>

                <div className="space-y-1.5">
                  {weatherData.dailyForecast.map((day, idx) => (
                    <button
                      key={day.date}
                      onClick={() => setSelectedDayIndex(idx)}
                      className={`w-full flex items-center justify-between p-2 rounded-2xl transition-all cursor-pointer text-xs font-bold ${
                        selectedDayIndex === idx
                          ? 'bg-white/20 text-white border border-white/30 shadow-md'
                          : 'hover:bg-white/10 text-white/85'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 font-mono text-[11px] text-sky-300">{day.dayNum}</span>
                        <span className="w-6">{day.dayName}</span>
                        <span className="text-sm">{getWeatherConditionText(day.code).split(' ')[1] || '☀️'}</span>
                      </div>

                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-white font-black">{day.tempMax}°</span>
                        <span className="text-white/50">{day.tempMin}°</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Card: 24-Hour Interactive Hourly DailyGraph */}
              <div className="md:col-span-7 bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-black text-white">
                      {isHe ? 'גרף שעות ביממה (Hourly Curve)' : '24-Hour Hourly Curve'}
                    </span>
                  </div>

                  {/* Graph metric toggle */}
                  <div className="flex items-center gap-1 bg-white/10 p-1 rounded-xl text-[10px] font-bold">
                    <button
                      onClick={() => setGraphMode('temp')}
                      className={`px-2 py-0.5 rounded-lg transition-all ${
                        graphMode === 'temp' ? 'bg-sky-500 text-white shadow' : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {isHe ? 'טמפ׳' : 'Temp'}
                    </button>
                    <button
                      onClick={() => setGraphMode('wind')}
                      className={`px-2 py-0.5 rounded-lg transition-all ${
                        graphMode === 'wind' ? 'bg-sky-500 text-white shadow' : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {isHe ? 'רוח' : 'Wind'}
                    </button>
                    <button
                      onClick={() => setGraphMode('humidity')}
                      className={`px-2 py-0.5 rounded-lg transition-all ${
                        graphMode === 'humidity' ? 'bg-sky-500 text-white shadow' : 'text-white/70 hover:text-white'
                      }`}
                    >
                      {isHe ? 'לחות' : 'Humid'}
                    </button>
                  </div>
                </div>

                {/* Hourly SVG Curve Canvas */}
                <div className="h-44 w-full relative flex items-end pt-4">
                  <div className="flex items-end justify-between w-full h-full gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {weatherData.hourlyForecast.slice(0, 14).map((h, i) => {
                      const val =
                        graphMode === 'temp' ? h.temp : graphMode === 'wind' ? h.windSpeed : h.humidity;
                      const maxVal =
                        graphMode === 'temp' ? 40 : graphMode === 'wind' ? 35 : 100;
                      const heightPct = Math.max(15, Math.min(90, (val / maxVal) * 100));

                      return (
                        <div key={i} className="flex flex-col items-center gap-1.5 flex-1 min-w-[36px]">
                          <span className="text-[10px] font-mono font-bold text-sky-200">
                            {val}
                            {graphMode === 'temp' ? '°' : graphMode === 'wind' ? 'k' : '%'}
                          </span>
                          <div className="w-full flex justify-center h-24 items-end">
                            <div
                              style={{ height: `${heightPct}%` }}
                              className="w-2.5 rounded-full bg-gradient-to-t from-sky-500 to-amber-300 shadow-md transition-all duration-500"
                            />
                          </div>
                          <span className="text-[11px]">{getWeatherConditionText(h.code).split(' ')[1] || '☀️'}</span>
                          <span className="text-[9px] font-mono text-white/50">{h.time.slice(0, 2)}:00</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="text-[10px] text-white/50 text-left pt-1 border-t border-white/5">
                  {isHe ? 'נתוני מודל ECMWF / Open-Meteo ברזולוציה גבוהה' : 'ECMWF High Resolution Forecast'}
                </div>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* STACK 2: UV INDEX, SUNRISE & SUNSET ARC, HUMIDITY DIAL          */}
            {/* ------------------------------------------------------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 1. UV Index Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-400" />
                    <span>{isHe ? 'קרינת UV' : 'UV Index'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">{weatherData.uvMax} מקסימום</span>
                </div>

                <div className="py-2 flex items-center justify-center">
                  <div className="relative w-28 h-28 rounded-full border-4 border-amber-500/20 flex flex-col items-center justify-center shadow-inner">
                    <span className="text-3xl font-black text-amber-300 drop-shadow">{weatherData.uvIndex}</span>
                    <span className="text-[10px] font-bold text-white/70">
                      {weatherData.uvIndex <= 2 ? 'נמוך' : weatherData.uvIndex <= 5 ? 'בינוני' : weatherData.uvIndex <= 7 ? 'גבוה' : 'קיצוני'}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {isHe ? 'מומלץ להשתמש בקרם הגנה בשעות הצהריים.' : 'Sun protection required during midday.'}
                </p>
              </div>

              {/* 2. Sunrise & Sunset Semicircular Arc Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Sunrise className="w-4 h-4 text-amber-300" />
                    <span>{isHe ? 'שמש (זריחה ושקיעה)' : 'Sun Position'}</span>
                  </span>
                </div>

                {/* Semicircular Sun Arc */}
                <div className="relative h-24 flex items-end justify-center overflow-hidden">
                  <div className="w-44 h-44 rounded-full border-2 border-dashed border-amber-400/40 relative flex items-center justify-center translate-y-20">
                    <div className="absolute top-0 w-4 h-4 rounded-full bg-amber-400 shadow-lg shadow-amber-400/80 animate-pulse" />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono font-bold pt-1 border-t border-white/10">
                  <div className="text-right">
                    <span className="text-[9px] text-white/50 block font-sans">{isHe ? 'זריחה' : 'Sunrise'}</span>
                    <span className="text-amber-200">{weatherData.sunrise}</span>
                  </div>
                  <div className="text-left">
                    <span className="text-[9px] text-white/50 block font-sans">{isHe ? 'שקיעה' : 'Sunset'}</span>
                    <span className="text-orange-300">{weatherData.sunset}</span>
                  </div>
                </div>
              </div>

              {/* 3. Humidity Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Droplets className="w-4 h-4 text-blue-400" />
                    <span>{isHe ? 'לחות יחסית' : 'Humidity'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">טל: {weatherData.dewPoint}°C</span>
                </div>

                <div className="py-2 flex items-center justify-center">
                  <div className="relative w-28 h-28 rounded-full border-4 border-blue-500/20 flex flex-col items-center justify-center shadow-inner">
                    <span className="text-3xl font-black text-blue-300 drop-shadow">{weatherData.humidity}%</span>
                    <span className="text-[10px] font-bold text-white/70">{isHe ? 'לחות אוויר' : 'Relative'}</span>
                  </div>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {isHe ? `נקודת הטל הנוכחית היא ${weatherData.dewPoint}°C.` : `The dew point is ${weatherData.dewPoint}°C.`}
                </p>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* STACK 3: WIND & COMPASS, AIR QUALITY (AQI), BAROMETRIC PRESSURE  */}
            {/* ------------------------------------------------------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 1. Wind & Compass Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-sky-400" />
                    <span>{isHe ? 'מצפן ורוח' : 'Wind & Compass'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">משבים: {weatherData.gustSpeed} קמ״ש</span>
                </div>

                <div className="py-2 flex items-center justify-center">
                  <div className="relative w-28 h-28 rounded-full border border-white/20 flex items-center justify-center bg-white/5">
                    <span className="absolute top-1 text-[9px] font-mono font-bold text-white/50">N</span>
                    <span className="absolute bottom-1 text-[9px] font-mono font-bold text-white/50">S</span>
                    <span className="absolute right-1.5 text-[9px] font-mono font-bold text-white/50">E</span>
                    <span className="absolute left-1.5 text-[9px] font-mono font-bold text-white/50">W</span>

                    {/* Rotating needle */}
                    <div
                      style={{ transform: `rotate(${weatherData.windDirection}deg)` }}
                      className="w-1 h-14 bg-gradient-to-t from-transparent via-sky-400 to-rose-400 rounded-full transition-transform duration-700 relative"
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 absolute -top-1 -left-0.5 shadow-md shadow-rose-500/80" />
                    </div>

                    <div className="absolute text-center">
                      <span className="text-xs font-black text-white block">{weatherData.windSpeed}</span>
                      <span className="text-[8px] text-white/60">קמ״ש</span>
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  כיוון {weatherData.windDirection}° • משבי רוח עד {weatherData.gustSpeed} קמ״ש
                </p>
              </div>

              {/* 2. Air Quality Index Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-emerald-400" />
                    <span>{isHe ? 'איכות האוויר (AQI)' : 'Air Quality'}</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${aqiInfo?.color || ''}`}>
                    {weatherData.aqiStatus}
                  </span>
                </div>

                <div className="py-2 text-center space-y-1">
                  <span className="text-4xl font-black text-white">{weatherData.aqi}</span>
                  <span className="text-[11px] block font-bold text-white/80">מדד זיהום US AQI</span>
                </div>

                <div className="flex justify-between text-[10px] text-white/70 pt-2 border-t border-white/10 font-mono">
                  <span>PM2.5: {weatherData.pm25} µg/m³</span>
                  <span>PM10: {weatherData.pm10} µg/m³</span>
                </div>
              </div>

              {/* 3. Barometric Pressure Card */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Gauge className="w-4 h-4 text-cyan-400" />
                    <span>{isHe ? 'לחץ ברומטרי' : 'Pressure'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">hPa</span>
                </div>

                <div className="py-2 text-center space-y-1">
                  <span className="text-4xl font-black text-cyan-300 drop-shadow">{weatherData.surfacePressure}</span>
                  <span className="text-[10px] block font-bold text-white/70">{isHe ? 'הקטורפסקל (hPa)' : 'Atmospheric Pressure'}</span>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {weatherData.surfacePressure >= 1013 ? 'לחץ אטמוספרי תקין ויציב.' : 'לחץ נמוך, אפשרות למשקעים.'}
                </p>
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* STACK 4: VISIBILITY, CLOUD COVER, PRECIPITATION                 */}
            {/* ------------------------------------------------------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 1. Visibility */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-sky-400" />
                    <span>{isHe ? 'טווח ראות' : 'Visibility'}</span>
                  </span>
                </div>

                <div className="py-2 text-center space-y-1">
                  <span className="text-4xl font-black text-white">{weatherData.visibility}</span>
                  <span className="text-xs block font-bold text-white/70">קילומטרים (km)</span>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {weatherData.visibility >= 10 ? 'ראות חדה ומצוינת ללא הגבלה.' : 'ראות מופחתת עקב ערפל או אובך.'}
                </p>
              </div>

              {/* 2. Cloud Cover */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <CloudSun className="w-4 h-4 text-sky-300" />
                    <span>{isHe ? 'כיסוי עננים' : 'Cloud Cover'}</span>
                  </span>
                  <span className="text-[10px] text-white/50">{weatherData.cloudCover}%</span>
                </div>

                <div className="py-2 text-center space-y-1">
                  <span className="text-4xl font-black text-sky-200 drop-shadow">{weatherData.cloudCover}%</span>
                  <div className="w-32 h-2 bg-white/10 rounded-full mx-auto overflow-hidden mt-1">
                    <div style={{ width: `${weatherData.cloudCover}%` }} className="h-full bg-sky-400 rounded-full" />
                  </div>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {weatherData.cloudCover < 20 ? 'שמיים נקיים ללא עננים.' : weatherData.cloudCover < 60 ? 'עננות חלקית מתונה.' : 'עננות כבדה וסמיכה.'}
                </p>
              </div>

              {/* 3. Precipitation */}
              <div className="bg-slate-900/70 border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <CloudRain className="w-4 h-4 text-blue-400" />
                    <span>{isHe ? 'משקעים וגשם' : 'Precipitation'}</span>
                  </span>
                </div>

                <div className="py-2 text-center space-y-1">
                  <span className="text-4xl font-black text-blue-300 drop-shadow">{weatherData.precipitation}</span>
                  <span className="text-xs block font-bold text-white/70">מ״מ (mm)</span>
                </div>

                <p className="text-[10px] text-white/60 text-center">
                  {weatherData.precipitation === 0 ? 'לא נמדדו משקעים בשעות האחרונות.' : `נמדדו ${weatherData.precipitation} מ״מ משקעים.`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
