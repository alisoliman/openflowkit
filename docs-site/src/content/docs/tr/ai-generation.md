---
draft: false
title: AI Generation
description: Flowpilot, BYOK sağlayıcılar, koddan mimari üretimi ve yapılandırılmış içe aktarma ile diyagram üretin ve geliştirin.
---

OpenFlowKit, Studio alanı üzerinden yapay zeka destekli diyagram üretimi sunar. Flowpilot özellikle ilk taslak, yapısal revizyon ve kod tabanlı mimari görünümü üretmek için güçlüdür.

## GitHub Copilot ile kurulum

Flowpilot varsayılan olarak **GitHub Copilot SDK** kullanır. Sağlayıcı API anahtarı
yerine CLI oturumunuzu ve Copilot kotanızı kullanır; kayıtlı diğer sağlayıcı
seçimleri korunur.

Node 20.19+ veya 22.12+ ve güncel GitHub CLI ile:

```bash
npm install
gh copilot login
npm run dev
```

**http://127.0.0.1:3000** adresini açıp **Settings → AI → GitHub Copilot →
Check connection** yolunu izleyin. Modeller hesabınızdan alınır. Kullanılabilirlik
ve kullanım çarpanları planınıza ve kuruluş politikasına bağlıdır.

SDK yerel bir Node sürecinde çalışır. `npm run dev` ve
`npm run build && npm run preview` yerel köprüyü içerir. Azure Static Web Apps
gibi statik siteler ve nginx Docker imajı bilgisayarınızdaki CLI oturumunu
okuyamaz. Copilot için uygulamayı yerel çalıştırın veya barındırılan sitede başka
bir sağlayıcı seçin.

CLI kimlik bilgileri tarayıcıya aktarılmaz. İstemler, konuşma bağlamı ve eklenen
görseller GitHub Copilot'a gönderilir. Köprü yalnızca aynı kaynaktan gelen
loopback isteklerini kabul eder. Dosya, kabuk, MCP, beceri ve ortak oturum
deposu erişimi kapalıdır. Geçici SDK oturumları her istekten sonra kaldırılır.
Kişisel oturumunuzu herkese açık bir sunucu üzerinden paylaşmayın.

İstekler ve otomatik DSL düzeltmeleri kotanızı kullanır. İptal işlemi SDK
isteğini durdurur; eksik yanıtlar tuvale uygulanmaz ve tarayıcı tarafından
otomatik olarak tekrar gönderilmez. Sonucu uygulamadan önce önizlemeyi inceleyin.

## Ardışık düzenlemeler ve otomatik uygulama

**Copilot modeli** seçicisi Flowpilot içinde de bulunur ve Ayarlar ile aynı
hesap modellerini kullanır. Seçim sonraki istekte kullanılır; konuşma korunur.
İlk taslağı uyguladıktan sonra **Edit current** varsayılandır. “Add Redis” veya
“Rename it” gibi kısa istekler düzenleme oluşturur. Bir planı “Yes, do that” ile
onaylamak, tekrar plan üretmek yerine değişiklikleri hazırlar.

Önizleme gerçek ekleme, silme, yeniden adlandırma ve bağlantı değişikliklerini
gösterir. Kod gerektiğinde **Diyagram kodunu göster** ile açılır. Atılan veya
geri alınan taslaklar konuşmada işaretlenir; sonraki yanıtlar gerçek tuvali esas alır.

İnceleme varsayılandır. **Düzenlemeleri otomatik uygula** seçeneğini açarsanız
tamamlanan düzenlemeler onaysız uygulanır. Her düzenleme tek bir geri alma
adımıdır; **AI düzenlemesini geri al** son AI değişikliğini geri alır.
Araya elle yapılan bir değişiklik girdiyse normal tuval Geri Al/Yinele
kontrollerini kullanın. Model ve otomatik uygulama tercihi kaydedilir.

İstek sürerken model ve uygulama modu kilitlidir. Tuval istek sırasında veya
önizleme beklerken değişirse eski taslağı uygulamak yerine güncel bir taslak
isteyin. Yenileme, bekleyen bir taslağı uygulanmış hale getirmez.

## Üründe AI nerede yer alır?

AI akışları Studio içindeki **Flowpilot** alanında ve Komut Merkezi üzerinden açılan **Open Flowpilot** eyleminde bulunur.

| Mod | Ne yapar |
| --- | --- |
| **Flowpilot** | sohbet tabanlı üretim ve revizyon |
| **From Code** | kaynak koddan mimari diyagram taslağı |
| **Import** | SQL, Terraform, K8s veya OpenAPI girdilerinden taslak |

Tipik üretim akışı:

1. istem ve varsa görsel alınır
2. yapılandırılmış sağlayıcıya gönderilir
3. yapısal graf temsili geri alınır
4. düğüm ve kenarlar oluşturulur
5. düzen uygulanır
6. önizleme onaylandıktan sonra mevcut graf değiştirilir veya güncellenir

## Sağlayıcı modeli

Copilot birincil motordur; mevcut yönlendirme, ayrıştırma, düzeltme, düzen ve
önizleme akışı korunur. Alternatif BYOK sağlayıcılar da kullanılabilir:

- Ollama
- Gemini
- OpenAI
- Claude
- Groq
- NVIDIA
- Cerebras
- Mistral
- OpenRouter
- özel OpenAI-uyumlu uç nokta

## AI ne zaman doğru araçtır?

Şu durumlarda kullanın:

- elinizde sadece doğal dil açıklaması varsa
- hızlı bir ilk taslak istiyorsanız
- mevcut diyagramı kavramsal olarak yeniden şekillendirmek istiyorsanız
- kaynak koddan yüksek seviyeli mimari çıkarımı almak istiyorsanız

Şu durumlarda başka akışlar daha iyidir:

- zaten kesin bir metinsel temsil varsa
- deterministik altyapı parse’ı istiyorsanız
- küçük diyagramı elle çizmek daha hızlıysa

## Daha iyi sonuç almak için

İyi istemler genellikle şunları içerir:

- hedef kitle
- sistemler veya aktörler
- önemli dallar ve hata yolları
- istenen yön
- istenen detay seviyesi

## Önerilen iş akışı

1. Flowpilot ile ilk taslağı üretin
2. tuval üzerinde yapıyı kontrol edin
3. [Properties Panel](/tr/properties-panel/) ile ayrıntıları düzeltin
4. gerekiyorsa [Smart Layout](/tr/smart-layout/) uygulayın
5. sonraki büyük revizyondan önce snapshot alın

## İlgili sayfalar

- [Ask Flowpilot](/tr/ask-flowpilot/)
- [Studio Overview](/tr/studio-overview/)
- [Choose an Input Mode](/tr/choose-input-mode/)
- [Prompting AI Agents](/tr/prompting-agents/)
