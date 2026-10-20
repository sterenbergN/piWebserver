// Small builders so each question reads like the question, not like JSON.
// Math uses String.raw so LaTeX backslashes stay as written.

export const num = (id, value, unit, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'numeric', value, ...(unit ? { unit } : {}), ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}), ...(opts.abs !== undefined ? { abs: opts.abs } : {}) },
  ...(opts.mistakes ? { mistakes: opts.mistakes } : {}),
});

export const choice = (id, options, correct, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'choice', options, correct },
  ...(opts.mistakes ? { mistakes: opts.mistakes } : {}),
});

export const multi = (id, options, correct, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'multi', options, correct },
});

export const range = (id, min, max, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'range', min, max, ...(opts.abs !== undefined ? { abs: opts.abs } : {}) },
});

export const coeffs = (id, numerator, denominator, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'coefficients', numerator, denominator },
});

export const order = (id, items, opts = {}) => ({
  id,
  ...(opts.prompt ? { prompt: opts.prompt } : {}),
  answer: { type: 'order', items },
});

/** Sources used again and again. */
export const SRC = {
  fe: (section) => ({ title: 'NCEES FE Reference Handbook (version 10.x)', detail: section }),
  hibbelerStatics: (detail) => ({ title: 'R. C. Hibbeler, Engineering Mechanics: Statics', detail }),
  hibbelerMoM: (detail) => ({ title: 'R. C. Hibbeler, Mechanics of Materials', detail }),
  cengelThermo: (detail) => ({ title: 'Y. A. Çengel & M. A. Boles, Thermodynamics: An Engineering Approach', detail }),
  incropera: (detail) => ({ title: 'F. P. Incropera et al., Fundamentals of Heat and Mass Transfer', detail }),
  munson: (detail) => ({ title: 'B. R. Munson et al., Fundamentals of Fluid Mechanics', detail }),
  shigley: (detail) => ({ title: 'R. G. Budynas & J. K. Nisbett, Shigley’s Mechanical Engineering Design', detail }),
  rao: (detail) => ({ title: 'S. S. Rao, Mechanical Vibrations', detail }),
  newnan: (detail) => ({ title: 'D. G. Newnan et al., Engineering Economic Analysis', detail }),
  nilsson: (detail) => ({ title: 'J. W. Nilsson & S. A. Riedel, Electric Circuits', detail }),
  chapman: (detail) => ({ title: 'S. J. Chapman, Electric Machinery Fundamentals', detail }),
  bolton: (detail) => ({ title: 'W. Bolton, Mechatronics: Electronic Control Systems in Mechanical and Electrical Engineering', detail }),
  nise: (detail) => ({ title: 'N. S. Nise, Control Systems Engineering', detail }),
  ogata: (detail) => ({ title: 'K. Ogata, Modern Control Engineering', detail }),
  astrom: (detail) => ({ title: 'K. J. Åström & T. Hägglund, PID Controllers: Theory, Design, and Tuning', detail }),
  zn: { title: 'J. G. Ziegler & N. B. Nichols, “Optimum Settings for Automatic Controllers”, Trans. ASME 64 (1942)' },
  iec61131: (detail) => ({ title: 'IEC 61131-3, Programmable controllers – Part 3: Programming languages', detail }),
  iec60204: (detail) => ({ title: 'IEC 60204-1, Safety of machinery – Electrical equipment of machines – Part 1: General requirements', detail }),
  iec61508: (detail) => ({ title: 'IEC 61508, Functional safety of electrical/electronic/programmable electronic safety-related systems', detail }),
  iec62061: (detail) => ({ title: 'IEC 62061, Safety of machinery – Functional safety of safety-related control systems', detail }),
  isa88: (detail) => ({ title: 'ANSI/ISA-88.00.01, Batch Control Part 1: Models and Terminology', detail }),
  isa95: (detail) => ({ title: 'ANSI/ISA-95.00.01, Enterprise-Control System Integration Part 1: Models and Terminology', detail }),
  namur43: { title: 'NAMUR NE 43, Standardization of the signal level for the failure information of digital transmitters' },
  siemensAnalog: (detail) => ({ title: 'Siemens, SIMATIC S7-1500 / ET 200MP Function Manual: Analog value processing', detail }),
  siemensGuide: (detail) => ({ title: 'Siemens, Programming Guideline for S7-1200/S7-1500', detail }),
  tiaHelp: (detail) => ({ title: 'Siemens TIA Portal (STEP 7) information system', detail }),
};
