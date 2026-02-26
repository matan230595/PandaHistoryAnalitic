# PandaHistoryAnalitic 🐼 (PRO)

גרסת פרודקשן מלאה:
- 🔐 Password Gate בסיסי (Client-side)
- 📊 ייצוא CSV + ייצוא Excel (.xlsx)
- 📈 סטטיסטיקות לפי שנה + לפי חודש (על נתונים גולמיים)
- 🔎 חיפוש וסינון בטבלה (כולל סינון לפי שנה/חודש)
- 🧹 דה-דופליקציה לפי URL מלא או דומיין בלבד
- 🗓️ תאריך ראשון/אחרון מתעדכן מיידית
- 📱 PWA (התקנה מהדפדפן) + אייקונים
- ✅ מותאם ל-Vercel

## הרצה מקומית
```bash
npm install
npm run dev
```

## Build / Preview
```bash
npm run build
npm run preview
```

## פריסה ל-Vercel
1. העלה את הפרויקט ל-GitHub
2. ב-Vercel: New Project → Import → Deploy
3. Environment Variables (מומלץ):
   - VITE_APP_PASSWORD = סיסמה
   - VITE_APP_TITLE = שם אפליקציה (אופציונלי)

## הערת אבטחה חשובה
Password Gate כאן הוא שכבת הגנה בסיסית בצד לקוח (לא Auth שרת). למוצר ציבורי/רגיש מומלץ להוסיף אימות שרת אמיתי.
