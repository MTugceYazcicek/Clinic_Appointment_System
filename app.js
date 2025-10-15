require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const exphbs = require('express-handlebars');
const sql = require('mssql');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const moment = require('moment');
const app = express();

// 1. VERİTABANI KONFİGÜRASYONU
const dbConfig = {
    user: process.env.DB_USER ,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER ,
    database: process.env.DB_DATABASE ,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true
    },
   
};

// 2. HANDLEBARS AYARLARI
const hbs = exphbs.create({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    helpers: {
        tomorrowAtEight: function () {
            return moment().add(1, 'days').set({ hour: 8, minute: 0 }).format('YYYY-MM-DDTHH:mm');
        },
        minDate: function () {
            return moment().add(1, 'days').format('YYYY-MM-DD');
        },
        maxDate: function () {
            return moment().add(30, 'days').format('YYYY-MM-DD');
        },
        formatDateTime: function (dateTime) {
            return moment(dateTime).format('DD.MM.YYYY HH:mm');
        }
    }
});
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
// 3. MIDDLEWARE'LER
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Kullanıcı oturum bilgisini view'lere aktar
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});



// 5. VERİTABANI BAĞLANTISI
const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ SQL Server bağlantısı başarılı');
        return pool;
    })
    .catch(err => {
        console.error('❌ Veritabanı bağlantı hatası:', err);
        process.exit(1);
    });

// 6. VERİTABANI SORGULARI İÇİN YARDIMCI FONKSİYON
const executeQuery = async (query, params = {}) => {
    const pool = await poolPromise;
    const request = pool.request();
    
    Object.keys(params).forEach(key => {
        const paramType = typeof params[key] === 'number' ? sql.Int : sql.NVarChar;
        request.input(key, paramType, params[key]);
    });
    
    return request.query(query);
};

// 7. KİMLİK DOĞRULAMA MIDDLEWARE'İ
const authenticate = (roles = []) => {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        
        if (roles.length > 0 && !roles.includes(req.session.user.role)) {
            return res.status(403).render('error', {
                title: 'Yetkisiz Erişim',
                message: 'Bu sayfaya erişim izniniz yok'
            });
        }
        
        next();
    };
};

// 8. ROTALAR

// Ana Sayfa
app.get('/', (req, res) => {
    res.render('home', { title: 'Ana Sayfa' });
});

// Giriş Sayfası
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { title: 'Giriş Yap', message: req.query.message });
});

// Giriş İşlemi
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await executeQuery(
            'SELECT id, name, email, password, role FROM users WHERE email = @email',
            { email }
        );
        
        if (result.recordset.length === 0) {
            return res.redirect('/login?message=Kullanıcı bulunamadı');
        }
        
        const user = result.recordset[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.redirect('/login?message=Şifre hatalı');
        }
        
        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        };
        
        res.redirect('/');
    } catch (err) {
        console.error('Giriş hatası:', err);
        res.status(500).render('error', {
            title: 'Sunucu Hatası',
            message: 'Giriş işlemi sırasında hata oluştu'
        });
    }
});

// Çıkış İşlemi
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('Oturum kapatma hatası:', err);
        res.redirect('/');
    });
});

// Doktor Listesi
app.get('/doctors', authenticate(), async (req, res) => {
    try {
        const result = await executeQuery(
            `SELECT u.id, u.name, d.specialty 
             FROM users u 
             JOIN doctors d ON u.id = d.user_id 
             WHERE u.role = 'doctor'
             ORDER BY u.name`
        );
        
        res.render('doctors', { 
            title: 'Doktorlar',
            doctors: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { 
            title: 'Hata',
            message: 'Doktor listesi alınamadı' 
        });
    }
});

// Randevu Formu
app.get('/appointment-form', authenticate(['patient']), async (req, res) => {
    try {
        const { doctorId } = req.query;
        
        if (!doctorId) return res.redirect('/doctors');
        
        const doctorResult = await executeQuery(
            `SELECT u.id, u.name, d.specialty 
             FROM users u 
             JOIN doctors d ON u.id = d.user_id 
             WHERE u.id = @doctorId`,
            { doctorId }
        );
        
        if (doctorResult.recordset.length === 0) {
            return res.status(404).render('error', {
                title: 'Hata',
                message: 'Doktor bulunamadı'
            });
        }
        
        res.render('appointment-form', {
            title: 'Randevu Al',
            doctor: doctorResult.recordset[0],
            doctorId
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { 
            title: 'Hata',
            message: 'Randevu formu yüklenemedi' 
        });
    }
});


// Doktorun uygun saatleri (API)
app.get('/api/doctors/:id/availability', authenticate(), async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query;
        
        // Validasyon
        if (!date) {
            return res.status(400).json({ 
                error: 'Tarih parametresi gereklidir',
                availableSlots: [] 
            });
        }

        // Doktorun o günkü randevularını al
        const appointments = await executeQuery(
            `SELECT appointment_date 
             FROM appointments 
             WHERE doctor_id = @doctorId 
             AND CONVERT(DATE, appointment_date) = @date
             AND status = 'scheduled'`,
            { doctorId: id, date }
        );
        
        // Çalışma saatleri (09:00-17:00 arası, 30 dakikalık aralıklarla)
        const availableSlots = [];
        const startHour = 9;
        const endHour = 17;
        const interval = 30;
        
        for (let hour = startHour; hour < endHour; hour++) {
            for (let minute = 0; minute < 60; minute += interval) {
                const time = new Date(`${date}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`);
                
                // Randevu çakışmasını kontrol et
                const isBooked = appointments.recordset.some(app => {
                    const appTime = new Date(app.appointment_date);
                    return appTime.getHours() === hour && appTime.getMinutes() === minute;
                });
                
                if (!isBooked) {
                    const endTime = new Date(time);
                    endTime.setMinutes(endTime.getMinutes() + interval);
                    
                    availableSlots.push({
                        time: time.toISOString(),
                        display: `${time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`,
                        hour,
                        minute
                    });
                }
            }
        }
        
        res.json({ 
            availableSlots,
            message: availableSlots.length === 0 ? 'Bu tarihte uygun randevu saati bulunmamaktadır' : null
        });
        
    } catch (err) {
        console.error('Doktor saatleri hatası:', err);
        res.status(500).json({ 
            error: 'Sunucu hatası',
            availableSlots: [] 
        });
    }
});
// Doktor randevu sayfası - GÜNCELLENMİŞ VERSİYON
app.get('/doctors/:id/appointment', authenticate(['patient']), async (req, res) => {
    try {
        const { id } = req.params;
        
        const doctorResult = await executeQuery(
            `SELECT u.id, u.name, d.specialty 
             FROM users u 
             JOIN doctors d ON u.id = d.user_id 
             WHERE u.id = @id`,
            { id }
        );
        
        if (doctorResult.recordset.length === 0) {
            return res.status(404).render('error', { 
                title: 'Hata', 
                message: 'Doktor bulunamadı' 
            });
        }
        
        const doctor = doctorResult.recordset[0];
        const now = new Date();
        
        res.render('appointment-form', {
            title: `${doctor.name} - Randevu Al`,
            doctor,
            now: now.toISOString() // Helper'lar global olduğu için sadece tarih gönderiyoruz
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { 
            title: 'Hata', 
            message: 'Doktor bilgileri yüklenemedi' 
        });
    }
});
// Randevu oluşturma
app.post('/appointments', authenticate(['patient']), async (req, res) => {
    try {
        const { doctorId, appointmentDateTime, description } = req.body;
        
        // Validate inputs
        if (!doctorId || !appointmentDateTime) {
            return res.status(400).json({
                success: false,
                message: 'Doctor ID and appointment date are required'
            });
        }

        // Validate date format
        const appointmentDate = new Date(appointmentDateTime);
        if (isNaN(appointmentDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date format'
            });
        }

        // Check if date is in the future
        if (appointmentDate < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Cannot create appointment in the past'
            });
        }

        // Check if doctor exists
        const doctorCheck = await executeQuery(
            'SELECT 1 FROM doctors WHERE user_id = @doctorId',
            { doctorId }
        );
        
        if (doctorCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Doctor not found'
            });
        }

        // Check for conflicting appointments
        const conflictCheck = await executeQuery(
            `SELECT 1 FROM appointments 
             WHERE doctor_id = @doctorId 
             AND appointment_date = @appointmentDate
             AND status = 'scheduled'`,
            {
                doctorId,
                appointmentDate: appointmentDateTime // Zaten ISO formatında
            }
        );

        if (conflictCheck.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Doktorun o saatte randevusu var lütfen başka bir saat seçiniz......'
            });
        }

        // Create appointment
        await executeQuery(
            `INSERT INTO appointments 
             (doctor_id, patient_id, appointment_date, status)
             VALUES (@doctorId, @patientId, @appointmentDate, 'scheduled')`,
            {
                doctorId,
                patientId: req.session.user.id,
                appointmentDate: appointmentDateTime, // ISO formatında
                
            }
        );

        res.json({
            success: true,
            message: 'Appointment created successfully'
        });

    } catch (error) {
        console.error('Appointment creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
    }
});

// Randevu Listesi
// Randevu Listesi
app.get('/appointments', authenticate(), async (req, res) => {
    try {
        const user = req.session.user;
        let query, params;

        if (user.role === 'doctor') {
            query = `
                SELECT 
                    a.id, 
                    a.appointment_date,
                    u.name as patient_name, 
                    a.status
                FROM appointments a 
                JOIN users u ON a.patient_id = u.id 
                WHERE a.doctor_id = @userId 
                ORDER BY a.appointment_date DESC
            `;
        } else {
            query = `
                SELECT 
                    a.id, 
                    a.appointment_date,
                    u.name as doctor_name, 
                    d.specialty, 
                    a.status
                FROM appointments a 
                JOIN users u ON a.doctor_id = u.id 
                JOIN doctors d ON u.id = d.user_id 
                WHERE a.patient_id = @userId 
                ORDER BY a.appointment_date DESC
            `;
        }

        const result = await executeQuery(query, { userId: user.id });

        // Randevu tarihlerini formatla
        const appointments = result.recordset.map(app => {
            return {
                ...app,
                formattedDate: new Date(app.appointment_date).toLocaleString('tr-TR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            };
        });

        res.render('appointments', {
            title: 'Randevularım',
            appointments,
            isDoctorView: user.role === 'doctor'
        });

    } catch (err) {
        console.error('Randevu yükleme hatası:', err);
        res.status(500).render('error', { 
            title: 'Hata',
            message: 'Randevular yüklenemedi. Lütfen daha sonra tekrar deneyin.' 
        });
    }
});


// Randevu İptal
app.post('/appointments/:id/cancel', authenticate(), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        
        const appointmentCheck = await executeQuery(
            `SELECT id FROM appointments 
             WHERE id = @id 
             AND (doctor_id = @userId OR patient_id = @userId)`,
            { id, userId: user.id }
        );
        
        if (appointmentCheck.recordset.length === 0) {
            return res.status(404).render('error', {
                title: 'Hata',
                message: 'Randevu bulunamadı veya erişim izniniz yok'
            });
        }
        
        await executeQuery(
            `UPDATE appointments 
             SET status = 'cancelled' 
             WHERE id = @id`,
            { id }
        );
        
        res.redirect('/appointments');
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { 
            title: 'Hata',
            message: 'Randevu iptal edilemedi' 
        });
    }
});

// Kayıt Sayfası
app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { 
        title: 'Kayıt Ol',
        message: req.query.message 
    });
});

// Kayıt İşlemi
app.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, specialty } = req.body;
        
        // E-posta formatını kontrol et
        if (!email.match(/\S+@\S+\.\S+/)) {
            return res.redirect('/register?message=Geçersiz e-posta formatı');
        }

        const emailCheck = await executeQuery(
            'SELECT id FROM users WHERE email = @email',
            { email }
        );
        
        if (emailCheck.recordset.length > 0) {
            return res.redirect('/register?message=Bu e-posta adresi zaten kullanılıyor');
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        
        try {
            await transaction.begin();
            const userRequest = new sql.Request(transaction);
            
            const userResult = await userRequest
                .input('name', sql.NVarChar, name)
                .input('email', sql.NVarChar, email)
                .input('password', sql.NVarChar, hashedPassword)
                .input('role', sql.NVarChar, role)
                .query(`INSERT INTO users (name, email, password, role) 
                        OUTPUT INSERTED.id 
                        VALUES (@name, @email, @password, @role)`);
            
            const userId = userResult.recordset[0].id;
            
            if (role === 'doctor') {
                if (!specialty) {
                    throw new Error('Uzmanlık alanı gereklidir');
                }
                
                const doctorRequest = new sql.Request(transaction);
                await doctorRequest
                    .input('userId', sql.Int, userId)
                    .input('specialty', sql.NVarChar, specialty)
                    .query('INSERT INTO doctors (user_id, specialty) VALUES (@userId, @specialty)');
            }
            
            await transaction.commit();
            
            // Yeni kayıt olan kullanıcıyı otomatik giriş yap
            req.session.user = {
                id: userId,
                name,
                email,
                role
            };
            
            res.redirect(role === 'doctor' ? '/doctors' : '/');
            
        } catch (err) {
            await transaction.rollback();
            console.error('Kayıt işlemi hatası:', err);
            const message = role === 'doctor' && !specialty 
                ? 'Doktorlar için uzmanlık alanı gereklidir'
                : 'Kayıt işlemi başarısız oldu';
            res.redirect(`/register?message=${message}`);
        }
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { 
            title: 'Hata',
            message: 'Kayıt işlemi sırasında beklenmeyen bir hata oluştu' 
        });
    }
});

// 9. HATA YÖNETİMİ
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Sayfa Bulunamadı',
        message: 'Aradığınız sayfa mevcut değil'
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        title: 'Sunucu Hatası',
        message: 'Bir hata oluştu, lütfen daha sonra tekrar deneyin'
    });
});

// 10. SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Sunucu http://localhost:${PORT} adresinde çalışıyor`);});