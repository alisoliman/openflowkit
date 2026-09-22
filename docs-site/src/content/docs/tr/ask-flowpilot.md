---
draft: false
title: Ask Flowpilot
description: Flowpilot’i Studio içindeki sohbet tabanlı yardımcı olarak kullanın; diyagram taslağı üretin, revize edin ve yön değiştirin.
---

Flowpilot, Studio içindeki sohbet tabanlı asistandır. Bir diyagramı doğal dille tarif etmek, mevcut bir taslağı yeniden kurmak veya farklı bir yapısal yaklaşım istemek için en hızlı yoldur.

## GitHub Copilot'u bağlayın

Varsayılan motor GitHub Copilot SDK'dır. `gh copilot login` ile oturum açın,
`npm run dev` ile yerel uygulamayı başlatın ve **Settings → AI → GitHub Copilot →
Check connection** yolunu izleyin. Ayrı API anahtarı gerekmez; Copilot kotanız
kullanılır ve modeller hesabınızdan alınır.

Statik barındırılan bir site yerel CLI oturumunuzu okuyamaz. Kurulum ve alternatif
sağlayıcılar için [AI Generation](/tr/ai-generation/) sayfasına bakın.

Üretilen diyagram önce önizleme olarak gösterilir. **Apply to canvas** ile
onaylayın veya **Discard** ile vazgeçin. İptal işlemi SDK isteğini durdurur ve
eksik bir taslağı tuvale uygulamaz.

Flowpilot içindeki **Copilot modeli** seçicisiyle sonraki isteğin modelini
değiştirebilirsiniz. **Düzenlemeleri otomatik uygula** seçeneği onay adımını
kaldırır; **AI düzenlemesini geri al** son AI değişikliğini geri almanızı sağlar.
İlk taslaktan sonra kısa takip istekleri mevcut diyagramı düzenler. Önizlemeler
gerçek değişiklikleri özetler; atılan taslaklar sonraki yanıtları yanıltmaz.

## İyi kullanım senaryoları

Flowpilot’i şu durumlarda kullanın:

- metin isteminden ilk taslağı üretmek için
- mevcut sistemi daha temiz bir yapıya çevirmek için
- eksik hata yollarını ve dalları eklemek için
- kod veya yapılandırılmış girdiden ilk diyagram taslağını almak için

## İsteminizde ne olmalı?

İyi istemler genelde şunları içerir:

- hedef kitle
- sistemler veya aktörler
- önemli dallar veya kısıtlar
- tercih edilen yön (`LR`, `TB` gibi)
- yüksek seviye mi, detaylı operasyon akışı mı istendiği

## Örnek istem

```text
Şu bileşenleri içeren soldan sağa bir SaaS mimarisi oluştur:
web istemcisi, API gateway, auth servisi, billing servisi,
Postgres, Redis cache, background workers ve S3 tabanlı dosya saklama.
Public ingress, async işler ve hata işleme yollarını göster.
```

## Üretimden sonra ne yapılmalı?

Flowpilot en güçlü halini taslak üreticisi olarak gösterir, son editör olarak değil. Üretimden sonra:

- yapıyı tuvalde inceleyin
- [Properties Panel](/tr/properties-panel/) ile etiket ve görsel ayarları düzeltin
- gerekirse [Smart Layout](/tr/smart-layout/) ile yerleşimi toplayın
- yeni büyük revizyonlardan önce snapshot alın

Mesaj gönderilir gönderilmez yazı alanı temizlenir; Flowpilot çalışırken sonraki
mesajınızı hazırlayabilirsiniz. Başarısız veya iptal edilen bir isteğin metni ve
eki, yalnızca bu sırada yazı alanını değiştirmediyseniz geri yüklenir.

## İlgili sayfalar

- [AI Generation](/tr/ai-generation/)
- [Prompting AI Agents](/tr/prompting-agents/)
- [Choose an Input Mode](/tr/choose-input-mode/)
