import { ArrowUpRight, Database, Github, Heart } from "lucide-react";
import { useAtlas } from "../atlas/context";
import { ORIGINAL_REPO_URL, REPO_URL } from "../config";

const BASE = import.meta.env.BASE_URL;

export function About() {
  const atlas = useAtlas();
  return (
    <div className="page about">
      <header className="about-hero">
        <img src={`${BASE}brand/og.webp`} alt="" />
        <div>
          <p className="eyebrow">Kelime Atlası hakkında</p>
          <h1 className="display">Her kelimeye bir resim.</h1>
          <p className="lede">
            Kelime Atlası, IELTS kelimelerini {atlas.count.toLocaleString("tr-TR")} karta dönüştürür. Her kelimenin özgün bir resmi, bir günlük ve bir IELTS örnek cümlesi, İngiliz ve Amerikan telaffuzu, sık kullanılan kalıpları ve Türkçe kullanım ipuçları var. Öğrendiğin her kelime gökyüzünde bir yıldız yakar.
          </p>
          <p className="lede">Ücretsiz, açık kaynak ve kayıt gerektirmez. Kod MIT, kelime verisi CC BY 4.0 lisanslıdır. Bu Türkçe sürüm, <a className="link" href={ORIGINAL_REPO_URL} target="_blank" rel="noreferrer">Word Atlas</a> projesinin (yazarları: designfuchen ve katkıda bulunanlar) uyarlamasıdır.</p>
          <div className="about-actions">
            <a className="btn btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
              <Github size={18} /> GitHub'da görüntüle
            </a>
            <a className="btn btn-ghost" href={`${REPO_URL}/tree/main/data`} target="_blank" rel="noreferrer">
              <Database size={18} /> Veriyi indir (JSON / CSV)
            </a>
          </div>
        </div>
      </header>

      <div className="about-grid">
        <section className="panel">
          <h3 className="eyebrow">Neden akılda kalır?</h3>
          <ul className="feature-list">
            <li>
              <b>Önce gör.</b> Her kelimenin, anlamını anında gösteren bir resmi var.
            </li>
            <li>
              <b>Sonra hatırla.</b> Anlam seçme, resimle cümle tamamlama, dinleyip tanıma ve yazım: tanımaktan yazabilmeye.
            </li>
            <li>
              <b>Tam unutmak üzereyken tekrar.</b> FSRS, yeni Anki sürümlerinin kullandığı açık kaynak hafıza algoritmasıdır; tekrarı ancak unutmak üzereyken planlar.
            </li>
            <li>
              <b>Dürüst puan.</b> Sadece ilk cevap sayılır. Yanlış kelimeler başka bir soru tipiyle tekrar gelir ama doğruluk oranını şişirmez.
            </li>
            <li>
              <b>İlerleme sadece senin.</b> Hesap yok, sunucu yok; veriler tarayıcında durur ve her an dışa aktarılabilir.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Klavye kısayolları</h3>
          <dl className="keys">
            <div>
              <dt>
                <kbd>⌘</kbd>
                <kbd>K</kbd> veya <kbd>/</kbd>
              </dt>
              <dd>Kelime ara</dd>
            </div>
            <div>
              <dt>
                <kbd>1</kbd>–<kbd>4</kbd>
              </dt>
              <dd>Cevap seç</dd>
            </div>
            <div>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>Onayla / devam</dd>
            </div>
            <div>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>Kartlar arasında önceki / sonraki</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Pencereyi kapat</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h3 className="eyebrow">İçerik nereden geliyor?</h3>
          <p className="muted">
            Tanımlar, örnek cümleler ve kalıplar orijinal Word Atlas projesinde büyük dil modelleriyle yazıldı; resimler görüntü modeliyle tek tip bir tarzda çizildi; sesler ElevenLabs ile sentezlendi (İngiliz: Alice, Amerikan: Sarah). Türkçe çeviriler yapay zekâ ile İngilizce metinlerden hazırlandı. İçerik otomatik olarak denetlendi ama tek tek insan gözünden geçmedi; hata görürsen GitHub'da bildirebilirsin.
          </p>
          <p className="muted">Bu resmî bir IELTS listesi değildir ve puan artışı vaat etmez. Amacı kelime öğrenmeyi biraz daha güzel ve sağlam hâle getirmek.</p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">Geliştiriciler için</h3>
          <p className="muted">
            <code>data/word-atlas-tr.json</code> ve <code>word-atlas-tr.csv</code> tam kelime verisidir; <code>public/atlas</code> içinde web uygulamasının parça verileri, resimleri ve sesleri bulunur. Anki desteleri, kelime uygulamaları ya da başka projeler için kaynak göstererek kullanabilirsin.
          </p>
          <a className="link" href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
            Belgeleri oku <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <p className="colophon">
        <Heart size={14} /> Kelime öğrenen herkes için.
      </p>
    </div>
  );
}
