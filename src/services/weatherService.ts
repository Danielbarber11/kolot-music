export interface CityWeather {
  city: string;
  country: string;
  lat: number;
  lon: number;
  temp: number;
  feelsLike: number;
  condition: string;
  conditionCode: number;
  isDaytime: boolean;
  windSpeed: number;
  windDirection: number;
  gustSpeed: number;
  humidity: number;
  dewPoint: number;
  uvIndex: number;
  uvMax: number;
  sunrise: string;
  sunset: string;
  aqi: number;
  aqiStatus: string;
  pm25: number;
  pm10: number;
  precipitation: number;
  cloudCover: number;
  visibility: number;
  surfacePressure: number;
  tempMax: number;
  tempMin: number;
  hourlyForecast: {
    time: string;
    temp: number;
    code: number;
    humidity: number;
    windSpeed: number;
    uv: number;
    precipitation: number;
  }[];
  dailyForecast: {
    date: string;
    dayNum: string;
    dayName: string;
    tempMax: number;
    tempMin: number;
    code: number;
  }[];
}

export const POPULAR_CITIES = [
  { city: 'ירושלים', country: 'ישראל', lat: 31.7683, lon: 35.2137 },
  { city: 'תל אביב', country: 'ישראל', lat: 32.0853, lon: 34.7818 },
  { city: 'חיפה', country: 'ישראל', lat: 32.794, lon: 34.9896 },
  { city: 'באר שבע', country: 'ישראל', lat: 31.253, lon: 34.7915 },
  { city: 'אילת', country: 'ישראל', lat: 29.5581, lon: 34.9482 },
  { city: 'טבריה', country: 'ישראל', lat: 32.7922, lon: 35.5312 },
  { city: 'ניו יורק', country: 'ארה"ב', lat: 40.7128, lon: -74.006 },
  { city: 'לונדון', country: 'בריטניה', lat: 51.5074, lon: -0.1278 },
  { city: 'פריז', country: 'צרפת', lat: 48.8566, lon: 2.3522 },
  { city: 'טוקיו', country: 'יפן', lat: 35.6762, lon: 139.6503 },
  { city: 'רומא', country: 'איטליה', lat: 41.9028, lon: 12.4964 },
];

export function getWeatherConditionText(code: number): string {
  if (code === 0) return 'בהיר ושמשי ☀️';
  if (code === 1) return 'בהיר ברובו 🌤️';
  if (code === 2) return 'מעונן חלקית ⛅';
  if (code === 3) return 'מעונן ☁️';
  if (code >= 45 && code <= 48) return 'ערפילי 🌫️';
  if (code >= 51 && code <= 55) return 'טפטוף קל 🌦️';
  if (code >= 61 && code <= 65) return 'גשום 🌧️';
  if (code >= 71 && code <= 77) return 'שלג ❄️';
  if (code >= 80 && code <= 82) return 'ממטרים חזקים ⛈️';
  if (code >= 95) return 'סופת רעמים ⚡';
  return 'נאה 🌤️';
}

export function getAqiStatusText(aqi: number): { text: string; color: string; desc: string } {
  if (aqi <= 50) return { text: 'מעולה (טוב)', color: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30', desc: 'איכות האוויר נחשבת מספקת, וזיהום האוויר מהווה סיכון מועט או בלתי קיים.' };
  if (aqi <= 100) return { text: 'סביר (מתון)', color: 'text-amber-400 bg-amber-500/20 border-amber-500/30', desc: 'איכות האוויר מקובלת; קיימת דאגה מתונה לקבוצות רגישות במיוחד.' };
  if (aqi <= 150) return { text: 'רגיש (לא בריא לקבוצות רגישות)', color: 'text-orange-400 bg-orange-500/20 border-orange-500/30', desc: 'חברי קבוצות רגישות עלולים לחוות השפעות בריאותיות.' };
  return { text: 'לא בריא', color: 'text-rose-400 bg-rose-500/20 border-rose-500/30', desc: 'כולם עלולים להתחיל לחוות השפעות בריאותיות.' };
}

export async function searchCitiesGeocoding(query: string) {
  if (!query.trim()) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=he&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      city: r.name,
      country: r.country || r.admin1 || '',
      lat: r.latitude,
      lon: r.longitude,
    }));
  } catch {
    return [];
  }
}

export async function fetchCityWeather(cityItem: { city: string; country: string; lat: number; lon: number }): Promise<CityWeather | null> {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${cityItem.lat}&longitude=${cityItem.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,weather_code,surface_pressure,cloud_cover,visibility,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&timezone=auto`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${cityItem.lat}&longitude=${cityItem.lon}&current=us_aqi,pm10,pm2_5&timezone=auto`;

  try {
    const [wRes, aqiRes] = await Promise.all([
      fetch(weatherUrl),
      fetch(aqiUrl).catch(() => null),
    ]);

    if (!wRes.ok) throw new Error('Open-Meteo weather request failed');
    const data = await wRes.json();
    const aqiData = aqiRes && aqiRes.ok ? await aqiRes.json() : null;

    const current = data.current || {};
    const daily = data.daily || {};
    const hourly = data.hourly || {};

    const daysShort = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const forecast = (daily.time || []).slice(0, 7).map((t: string, i: number) => {
      const d = new Date(t);
      return {
        date: t,
        dayNum: `${d.getDate()}`,
        dayName: daysShort[d.getDay()] || t,
        tempMax: Math.round(daily.temperature_2m_max?.[i] ?? 24),
        tempMin: Math.round(daily.temperature_2m_min?.[i] ?? 16),
        code: daily.weather_code?.[i] ?? 0,
      };
    });

    const hourlyList = (hourly.time || []).slice(0, 24).map((t: string, i: number) => {
      const d = new Date(t);
      const hoursStr = `${d.getHours().toString().padStart(2, '0')}:00`;
      return {
        time: hoursStr,
        temp: Math.round(hourly.temperature_2m?.[i] ?? 20),
        code: hourly.weather_code?.[i] ?? 0,
        humidity: Math.round(hourly.relative_humidity_2m?.[i] ?? 50),
        windSpeed: Math.round(hourly.wind_speed_10m?.[i] ?? 10),
        uv: Math.round(hourly.uv_index?.[i] ?? 3),
        precipitation: hourly.precipitation?.[i] ?? 0,
      };
    });

    // Format Sunrise / Sunset nicely
    const rawSunrise = daily.sunrise?.[0] ? new Date(daily.sunrise[0]) : new Date();
    const rawSunset = daily.sunset?.[0] ? new Date(daily.sunset[0]) : new Date();
    const sunriseTime = `${rawSunrise.getHours().toString().padStart(2, '0')}:${rawSunrise.getMinutes().toString().padStart(2, '0')}`;
    const sunsetTime = `${rawSunset.getHours().toString().padStart(2, '0')}:${rawSunset.getMinutes().toString().padStart(2, '0')}`;

    const rawAqi = aqiData?.current?.us_aqi ?? 38;
    const aqiMeta = getAqiStatusText(rawAqi);

    const dew = hourly.dew_point_2m?.[0] ?? (current.temperature_2m - (100 - (current.relative_humidity_2m || 50)) / 5);
    const vis = (hourly.visibility?.[0] ? hourly.visibility[0] / 1000 : 10.0);

    return {
      city: cityItem.city,
      country: cityItem.country,
      lat: cityItem.lat,
      lon: cityItem.lon,
      temp: Math.round(current.temperature_2m ?? 22),
      feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 22),
      condition: getWeatherConditionText(current.weather_code ?? 0),
      conditionCode: current.weather_code ?? 0,
      isDaytime: current.is_day === 1,
      windSpeed: Math.round(current.wind_speed_10m ?? 12),
      windDirection: Math.round(current.wind_direction_10m ?? 180),
      gustSpeed: Math.round(current.wind_gusts_10m ?? 18),
      humidity: Math.round(current.relative_humidity_2m ?? 50),
      dewPoint: Math.round(dew),
      uvIndex: Math.round(daily.uv_index_max?.[0] ?? 4),
      uvMax: Math.round(daily.uv_index_max?.[0] ?? 6),
      sunrise: sunriseTime,
      sunset: sunsetTime,
      aqi: rawAqi,
      aqiStatus: aqiMeta.text,
      pm25: Math.round(aqiData?.current?.pm2_5 ?? 8),
      pm10: Math.round(aqiData?.current?.pm10 ?? 15),
      precipitation: current.precipitation ?? 0,
      cloudCover: Math.round(current.cloud_cover ?? 30),
      visibility: Number(vis.toFixed(1)),
      surfacePressure: Math.round(current.surface_pressure ?? 1013),
      tempMax: Math.round(daily.temperature_2m_max?.[0] ?? current.temperature_2m ?? 25),
      tempMin: Math.round(daily.temperature_2m_min?.[0] ?? 16),
      hourlyForecast: hourlyList,
      dailyForecast: forecast,
    };
  } catch (err) {
    console.error('Weather fetch error:', err);
    return null;
  }
}
