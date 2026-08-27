// بيانات السيارات المعروضة في المعرض
const cars = [
  { name: "تويوتا كامري 2024", type: "سيدان - اقتصادية", price: 115000, icon: "🚘" },
  { name: "هيونداي توسان 2024", type: "SUV - عائلية", price: 138000, icon: "🚙" },
  { name: "لكزس ES 2024", type: "سيدان - فاخرة", price: 210000, icon: "🚗" },
  { name: "فورد F-150 2024", type: "بيك أب", price: 175000, icon: "🛻" },
  { name: "كيا سيراتو 2024", type: "سيدان - اقتصادية", price: 78000, icon: "🚘" },
  { name: "شيفروليه تاهو 2024", type: "SUV - كبيرة", price: 245000, icon: "🚙" },
];

const carsGrid = document.getElementById("carsGrid");

function formatCurrency(value) {
  return Math.round(value).toLocaleString("ar-SA") + " ر.س";
}

function renderCars() {
  carsGrid.innerHTML = cars.map((car, index) => `
    <div class="car-card">
      <div class="car-media">${car.icon}</div>
      <div class="car-body">
        <h3>${car.name}</h3>
        <p class="car-meta">${car.type}</p>
        <p class="car-price">${formatCurrency(car.price)}</p>
        <button class="car-cta" data-price="${car.price}">احسب القسط الشهري</button>
      </div>
    </div>
  `).join("");
}

renderCars();

// عند الضغط على "احسب القسط الشهري" داخل بطاقة سيارة: نملأ السعر وننتقل للحاسبة
carsGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".car-cta");
  if (!btn) return;
  document.getElementById("carPrice").value = btn.dataset.price;
  document.getElementById("calculator").scrollIntoView({ behavior: "smooth" });
});

// قائمة الجوال
const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");
menuToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
navLinks.addEventListener("click", (e) => {
  if (e.target.tagName === "A") navLinks.classList.remove("open");
});

// حاسبة التمويل
const calcForm = document.getElementById("calcForm");
const calcResult = document.getElementById("calcResult");

// نسبة الالتزامات القصوى المسموح بها من الراتب (قاعدة شائعة لدى جهات التمويل)
const MAX_DEBT_BURDEN_RATIO = 0.65;

function computeInstallment(principal, annualRatePercent, months) {
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function computeMaxLoan(maxInstallment, annualRatePercent, months) {
  const monthlyRate = annualRatePercent / 100 / 12;
  if (maxInstallment <= 0) return 0;
  if (monthlyRate === 0) return maxInstallment * months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (maxInstallment * (factor - 1)) / (monthlyRate * factor);
}

calcForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const carPrice = parseFloat(document.getElementById("carPrice").value) || 0;
  const downPayment = parseFloat(document.getElementById("downPayment").value) || 0;
  const salary = parseFloat(document.getElementById("salary").value) || 0;
  const obligations = parseFloat(document.getElementById("obligations").value) || 0;
  const months = parseInt(document.getElementById("months").value, 10);
  const rate = parseFloat(document.getElementById("rate").value) || 0;

  if (carPrice <= 0 || salary <= 0) {
    calcResult.innerHTML = `
      <div class="result-placeholder">
        <span class="result-icon">⚠️</span>
        <p>يرجى إدخال سعر السيارة والراتب الشهري بشكل صحيح</p>
      </div>`;
    return;
  }

  const financedAmount = Math.max(carPrice - downPayment, 0);

  if (financedAmount === 0) {
    calcResult.innerHTML = `
      <div class="result-placeholder">
        <span class="result-icon">✅</span>
        <p>الدفعة المقدمة تغطي كامل سعر السيارة، لا حاجة للتمويل</p>
      </div>`;
    return;
  }

  const monthlyInstallment = computeInstallment(financedAmount, rate, months);
  const totalPayment = monthlyInstallment * months;
  const totalProfit = totalPayment - financedAmount;

  const maxAllowedInstallment = Math.max(salary * MAX_DEBT_BURDEN_RATIO - obligations, 0);
  const debtBurdenRatio = ((monthlyInstallment + obligations) / salary) * 100;
  const isEligible = monthlyInstallment <= maxAllowedInstallment;

  const maxLoanBySalary = computeMaxLoan(maxAllowedInstallment, rate, months);
  const maxCarPriceBySalary = maxLoanBySalary + downPayment;

  calcResult.innerHTML = `
    <div class="result-content">
      <div class="result-headline">
        <span class="label">القسط الشهري التقريبي</span>
        <span class="value">${formatCurrency(monthlyInstallment)}</span>
      </div>

      <div class="result-list">
        <div class="result-row"><span>مبلغ التمويل</span><span>${formatCurrency(financedAmount)}</span></div>
        <div class="result-row"><span>إجمالي المبلغ المسدد (${months} شهر)</span><span>${formatCurrency(totalPayment)}</span></div>
        <div class="result-row"><span>إجمالي الربح/التكلفة الإضافية</span><span>${formatCurrency(totalProfit)}</span></div>
        <div class="result-row"><span>نسبة الالتزامات من الراتب</span><span>${debtBurdenRatio.toFixed(1)}%</span></div>
        <div class="result-row"><span>أقصى سعر سيارة يناسب راتبك (بنفس المدة والدفعة)</span><span>${formatCurrency(Math.max(maxCarPriceBySalary, 0))}</span></div>
      </div>

      <div class="eligibility ${isEligible ? "ok" : "warn"}">
        ${isEligible
          ? "✅ القسط الشهري يقع ضمن الحد المسموح به وفق راتبك"
          : "⚠️ القسط الشهري مرتفع مقارنة براتبك، يُفضّل زيادة الدفعة المقدمة أو تمديد مدة التمويل"}
      </div>
    </div>
  `;
});
