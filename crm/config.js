/* إعدادات الاتصال بقاعدة البيانات (Supabase) لنظام إدارة العملاء
   ضع هنا "Project URL" و "anon public key" من:
   Supabase Dashboard ← Project Settings ← API Keys
   المفتاح العام (anon / publishable) آمن للنشر؛ الحماية تتم بصلاحيات قاعدة البيانات (RLS).
   لا تضع أبدًا مفتاح service_role / secret.
   إذا تُركت القيم فارغة يعمل النظام في "الوضع المحلي" على المتصفح فقط. */
window.ROWAAD_CRM_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
