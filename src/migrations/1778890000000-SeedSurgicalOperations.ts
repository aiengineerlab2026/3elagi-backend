import { MigrationInterface, QueryRunner } from 'typeorm';

/** Predefined surgeries per speciality (keyed by doctor_specialities.name_en). [en, ar] */
const SEED: Record<string, [string, string][]> = {
  Cardiology: [
    ['Coronary Artery Bypass Grafting (CABG)', 'جراحة تحويل مسار الشريان التاجي'],
    ['Cardiac Catheterization', 'قسطرة القلب'],
    ['Coronary Angioplasty & Stenting', 'توسيع الشرايين التاجية وتركيب الدعامات'],
    ['Heart Valve Replacement', 'استبدال صمام القلب'],
    ['Pacemaker Implantation', 'زرع منظم ضربات القلب'],
    ['Cardiac Ablation', 'الكي الكهربائي للقلب'],
  ],
  Dentistry: [
    ['Tooth Extraction', 'خلع الأسنان'],
    ['Wisdom Tooth Surgery', 'جراحة ضرس العقل'],
    ['Dental Implant', 'زراعة الأسنان'],
    ['Root Canal Treatment', 'علاج العصب'],
    ['Gum Surgery', 'جراحة اللثة'],
    ['Dental Bone Graft', 'ترقيع عظم الفك'],
  ],
  Dermatology: [
    ['Mole / Skin Lesion Removal', 'إزالة الشامات والزوائد الجلدية'],
    ['Cyst Excision', 'استئصال الأكياس الجلدية'],
    ['Laser Skin Resurfacing', 'تقشير الجلد بالليزر'],
    ['Scar Revision', 'تجميل الندبات'],
    ['Hair Transplant', 'زراعة الشعر'],
  ],
  ENT: [
    ['Tonsillectomy', 'استئصال اللوزتين'],
    ['Adenoidectomy', 'استئصال اللحمية'],
    ['Septoplasty', 'تعديل الحاجز الأنفي'],
    ['Endoscopic Sinus Surgery (FESS)', 'جراحة الجيوب الأنفية بالمنظار'],
    ['Tympanoplasty', 'ترقيع طبلة الأذن'],
    ['Ear Tubes (Myringotomy)', 'تركيب أنابيب الأذن'],
  ],
  Gastroenterology: [
    ['Upper Endoscopy (Gastroscopy)', 'منظار المعدة'],
    ['Colonoscopy', 'منظار القولون'],
    ['ERCP', 'تنظير القنوات الصفراوية والبنكرياس'],
    ['Endoscopic Polypectomy', 'استئصال الزوائد اللحمية بالمنظار'],
    ['Esophageal Variceal Banding', 'ربط دوالي المريء بالمنظار'],
  ],
  Gynaecology: [
    ['Caesarean Section', 'الولادة القيصرية'],
    ['Hysterectomy', 'استئصال الرحم'],
    ['Laparoscopic Ovarian Cystectomy', 'استئصال كيس المبيض بالمنظار'],
    ['Myomectomy', 'استئصال الأورام الليفية'],
    ['Dilation and Curettage (D&C)', 'توسيع وكحت الرحم'],
    ['Hysteroscopy', 'منظار الرحم'],
  ],
  Neurology: [
    ['Brain Tumor Resection', 'استئصال ورم المخ'],
    ['Discectomy (Herniated Disc Surgery)', 'جراحة الانزلاق الغضروفي'],
    ['Spinal Fusion', 'تثبيت الفقرات'],
    ['VP Shunt Placement', 'تركيب صمام لتصريف السائل الدماغي'],
    ['Carpal Tunnel Release', 'تحرير النفق الرسغي'],
  ],
  Ophthalmology: [
    ['Cataract Surgery (Phaco)', 'إزالة المياه البيضاء بالفاكو'],
    ['LASIK', 'تصحيح النظر بالليزك'],
    ['Glaucoma Surgery', 'جراحة المياه الزرقاء'],
    ['Vitrectomy', 'استئصال الجسم الزجاجي'],
    ['Strabismus Surgery', 'جراحة الحول'],
    ['Corneal Transplant', 'زراعة القرنية'],
  ],
  Orthopedics: [
    ['Total Knee Replacement', 'تغيير مفصل الركبة'],
    ['Total Hip Replacement', 'تغيير مفصل الفخذ'],
    ['Knee Arthroscopy', 'منظار الركبة'],
    ['ACL Reconstruction', 'إعادة بناء الرباط الصليبي'],
    ['Fracture Fixation (ORIF)', 'تثبيت الكسور جراحياً'],
    ['Shoulder Arthroscopy', 'منظار الكتف'],
  ],
  Pediatrics: [
    ['Circumcision', 'الختان'],
    ['Pediatric Inguinal Hernia Repair', 'إصلاح الفتق الإربي للأطفال'],
    ['Orchiopexy (Undescended Testis)', 'إنزال الخصية المعلقة'],
    ['Pyloromyotomy', 'جراحة ضيق فتحة البواب'],
  ],
  Surgery: [
    ['Laparoscopic Appendectomy', 'استئصال الزائدة الدودية بالمنظار'],
    ['Laparoscopic Cholecystectomy', 'استئصال المرارة بالمنظار'],
    ['Inguinal Hernia Repair', 'إصلاح الفتق الإربي'],
    ['Umbilical Hernia Repair', 'إصلاح الفتق السري'],
    ['Thyroidectomy', 'استئصال الغدة الدرقية'],
    ['Sleeve Gastrectomy', 'تكميم المعدة'],
    ['Gastric Bypass', 'تحويل مسار المعدة'],
    ['Hemorrhoidectomy', 'استئصال البواسير'],
  ],
};

export class SeedSurgicalOperations1778890000000 implements MigrationInterface {
  name = 'SeedSurgicalOperations1778890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [speciality, ops] of Object.entries(SEED)) {
      for (const [nameEn, nameAr] of ops) {
        // Skips specialities that don't exist and surgeries already added (e.g. by an admin).
        await queryRunner.query(
          `INSERT INTO "surgical_operations" ("name_en", "name_ar", "speciality_id")
           SELECT $1::varchar, $2::varchar, s."id" FROM "doctor_specialities" s
           WHERE s."name_en" = $3::varchar
             AND NOT EXISTS (
               SELECT 1 FROM "surgical_operations" o
               WHERE o."speciality_id" = s."id" AND LOWER(o."name_en") = LOWER($1::varchar)
             )
           LIMIT 1`,
          [nameEn, nameAr, speciality],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const names = Object.values(SEED).flat().map(([en]) => en);
    await queryRunner.query(`DELETE FROM "surgical_operations" WHERE "name_en" = ANY($1)`, [names]);
  }
}
