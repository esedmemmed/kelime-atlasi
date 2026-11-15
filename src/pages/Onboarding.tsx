import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useAtlas } from "../atlas/context";
import { store } from "../store/store";

const ALL_LEVELS = [
  ["A1", "Başlangıç", "Sıfırdan ya da baştan başla"],
  ["A2", "Temel", "Günlük kelimeler henüz oturmadı"],
  ["B1", "Orta", "Hedef IELTS 5.5 – 6"],
  ["B2", "Orta üstü", "Hedef IELTS 6.5 – 7"],
  ["C1", "İleri", "Hedef 7.5 ve üzeri"],
];

export function Onboarding() {
  const atlas = useAtlas();
  // Only offer levels that already have translated words.
  const present = new Set(atlas.words.map((w) => atlas.cefr[w.cefr]));
  const avail = ALL_LEVELS.filter(([code]) => present.has(code));
  const LEVELS = avail.length > 4 ? avail.slice(1, 5) : avail;
  const [level, setLevel] = useState(avail.length > 4 ? 1 : 0);
  const [goal, setGoal] = useState(10);
  const finish = () => store.settings({ onboarded: true, startLevel: atlas.cefr.indexOf(LEVELS[level][0]), dailyNew: goal });
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="Hoş geldiniz">
      <div className="onboard-card">
        <img className="onboard-art" src={`${import.meta.env.BASE_URL}brand/hero.webp`} alt="" />
        <div className="onboard-body">
          <p className="eyebrow">Kelime Atlası'na hoş geldin</p>
          <h1 className="display">
            {atlas.count.toLocaleString()} yıldız
            <br />
            tek tek yakılmayı bekliyor.
          </h1>
          <fieldset>
            <legend>Nereden başlamak istersin?</legend>
            <div className="choice-grid">
              {LEVELS.map(([code, name, desc], i) => (
                <button key={code} className={`choice ${level === i ? "is-on" : ""}`} onClick={() => setLevel(i)} aria-pressed={level === i}>
                  <span className={`chip chip-level lv-${code}`}>{code}</span>
                  <b>{name}</b>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Günde kaç yeni yıldız?</legend>
            <div className="segmented segmented-wide">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className={goal === n ? "is-on" : ""} onClick={() => setGoal(n)} aria-pressed={goal === n}>
                  {n} kelime{n === 10 ? " · önerilen" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary btn-xl" onClick={finish}>
            Başla <ArrowRight size={20} />
          </button>
          <p className="muted">Kayıt gerekmez. İlerlemen yalnızca bu cihazda tutulur; ayarları istediğin zaman «Ben» sekmesinden değiştirebilirsin.</p>
        </div>
      </div>
    </div>
  );
}
