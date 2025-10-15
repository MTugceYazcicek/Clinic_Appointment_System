# Clinic_Appointment_System
Clinic_Appointment_System
# 🏥 Appointment Management System (Node.js + MSSQL)

Bu proje, **doktor-randevu yönetim sistemi** örneği olarak geliştirilmiştir.  
Kullanıcılar hasta veya doktor olarak kayıt olabilir, giriş yapabilir ve randevu oluşturup yönetebilirler.

## 🚀 Özellikler

- 👩‍⚕️ Doktor ve hasta rolleri
- 🔐 Giriş ve kayıt sistemi (şifreler `bcryptjs` ile hashlenir)
- 📅 Randevu alma, iptal etme, görüntüleme
- 📆 Doktorların uygun saatlerini listeleme (09:00–17:00 arası, 30 dk aralıklarla)
- 🔒 Oturum yönetimi (`express-session`)
- 🧩 SQL Server veritabanı bağlantısı (`mssql`)
- 🎨 Handlebars şablon motoru ile dinamik HTML sayfalar

---

## 🧱 Teknolojiler

| Katman | Teknoloji |
|--------|------------|
| Backend | Node.js, Express.js |
| Database | Microsoft SQL Server |
| Template Engine | Handlebars (hbs) |
| Authentication | express-session, bcryptjs |
| Environment | dotenv |
| Time Formatting | moment.js |

---

## ⚙️ Kurulum Adımları

### 1️⃣ Projeyi klonla
```bash
git clone https://github.com/<kullanici-adin>/<repo-adi>.git
cd <repo-adi>
```
---
### 2 Paketleri indir
```bash
npm install
```
---
### env düzenle
```bash
DB_USER=your_db_username
DB_PASSWORD=your_db_password
DB_SERVER=your_server_address
DB_DATABASE=your_database_name

SESSION_SECRET=your_secret_session_key
PORT=****
```
