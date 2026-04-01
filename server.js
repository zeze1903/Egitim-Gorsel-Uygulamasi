require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { HfInference } = require('@huggingface/inference');
const translate = require('google-translate-api-next');

const app = express();
const hf = new HfInference(process.env.HF_TOKEN);

// 1. Veritabanı Bağlantısı ve Tablo Oluşturma
const db = new sqlite3.Database('gorseller.db');

db.run(`
    CREATE TABLE IF NOT EXISTS gorseller(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sinif TEXT,
    ders TEXT,
    unite TEXT,
    konu TEXT,
    kazanim TEXT,
    gorsel TEXT,
    tarih DATETIME DEFAULT CURRENT_TIMESTAMP)
`);

// 2. Middleware Ayarları
app.use(express.json());
app.use(express.static('public'));

// 3. GÖRSEL OLUŞTURMA ROTASI (Çeviri + AI Prompt)
app.post("/gorsel-olustur", async (req, res) => {
    try {
        const { konu, kazanim } = req.body;

        console.log("Gelen Veri:", konu, kazanim);

        const trFunc = typeof translate === 'function' ? translate : translate.default;

        // Türkçeden İngilizceye Çeviri
        const ceviriKonu = await trFunc(konu, { from: 'tr', to: 'en' });
        const ceviriKazanim = await trFunc(kazanim, { from: 'tr', to: 'en' });

        // Eğitim Odaklı Profesyonel Prompt
        const prompt = `Educational illustration for kids, subject: ${ceviriKonu.text}. 
                        Specifically showing: ${ceviriKazanim.text}. 
                        Style: minimalist flat vector art, vibrant friendly colors, 
                        white background, no text, clear outlines, 
                        high quality, professional digital drawing for schools.`;

        console.log("AI Promptu:", prompt);

        // Hugging Face üzerinden görsel üretimi
        const image = await hf.textToImage({
            model: "stabilityai/stable-diffusion-xl-base-1.0",
            inputs: prompt,
            parameters: { guidance_scale: 8.5 }
        });

        const buffer = Buffer.from(await image.arrayBuffer());
        const fileName = `img_${Date.now()}.png`;
        const filePath = path.join(__dirname, 'public', fileName);

        fs.writeFileSync(filePath, buffer);
        res.json({ gorselYolu: "/" + fileName });

    } catch (err) {
        console.error("Üretim Hatası:", err);
        res.status(500).json({ hata: "Görsel üretilemedi!" });
    }
});

// 4. VERİTABANINA KAYDETME ROTASI
app.post("/gorsel-kaydet", (req, res) => {
    const { sinif, ders, unite, konu, kazanim, gorsel } = req.body;
    // 'localtime' ekleyerek Türkiye saatine göre kayıt yapıyoruz
    const sql = `INSERT INTO gorseller (sinif, ders, unite, konu, kazanim, gorsel, tarih) 
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`;

    db.run(sql, [sinif, ders, unite, konu, kazanim, gorsel], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ hata: "Kaydedilemedi!" });
        }
        res.json({ mesaj: "Başarıyla kaydedildi!" });
    });
});

// 5. İPTAL DURUMUNDA FİZİKSEL DOSYA SİLME (Kayıt Öncesi)
app.post("/gorsel-sil", (req, res) => {
    const { gorselYolu } = req.body;
    const filePath = path.join(__dirname, 'public', gorselYolu);

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ mesaj: "Geçici dosya silindi." });
    } else {
        res.status(404).json({ hata: "Dosya bulunamadı." });
    }
});

// 6. KÜTÜPHANEDEN SİLME (Veritabanı + Dosya)
app.post("/gorsel-sil-veritabani", (req, res) => {
    const { id, gorselYolu } = req.body;

    db.run("DELETE FROM gorseller WHERE id = ?", [id], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ hata: "Silinemedi!" });
        }

        const filePath = path.join(__dirname, 'public', gorselYolu);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ mesaj: "Kayıt tamamen silindi." });
    });
});

// 7. LİSTELEME ROTASI
app.get("/tum-gorseller", (req, res) => {
    db.all("SELECT * FROM gorseller ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ hata: "Veriler alınamadı" });
        res.json(rows);
    });
});

// 8. SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda yayında...`);
});