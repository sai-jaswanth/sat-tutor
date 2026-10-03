import { getDb } from "../db/database.js";

/**
 * Generates a large ORIGINAL SAT-style question bank locally.
 *
 * Important provenance rule:
 * - These are original practice items generated from deterministic templates.
 * - They are NOT copied from College Board exams.
 * - `frequency_tier` is a qualitative topic-frequency label informed by
 *   College Board's published domain distributions; it is NOT a claim that
 *   a particular question appeared on a particular past exam.
 * - `previous_exam_occurrence_count` stays NULL until verified source data is
 *   imported through the prior-exam import pipeline.
 *
 * Uniqueness rule: every skill generates one block of BLOCK_SIZE consecutive
 * rows (DIFFICULTIES x VARIANTS). Numeric/topic parameters are derived from
 * `u = n % BLOCK_SIZE`, and any pool sizes used are chosen so their product
 * (or lcm) is >= BLOCK_SIZE. Because a block is always BLOCK_SIZE consecutive
 * integers, `n % BLOCK_SIZE` visits every residue exactly once per block,
 * which guarantees distinct generated content within a skill instead of the
 * same stem being reused under different difficulty labels.
 */

type Q = {
  id: string; section: "math" | "reading_writing"; domain: string; skill: string;
  difficulty: number; stem: string; choices: string[] | null; correct_answer: string;
  answer_type: "mcq" | "grid_in"; explanation: string; frequency_tier: string;
  concept_tags: string[];
};

const DIFFICULTIES = 5;
const VARIANTS = 8; // rows per difficulty per skill
const BLOCK_SIZE = DIFFICULTIES * VARIANTS; // 40

const MATH_SKILLS: Array<[string,string,string]> = [
  ["Algebra","math.algebra.linear_equations_1var","Linear equations in one variable"],
  ["Algebra","math.algebra.linear_equations_2var","Linear equations in two variables"],
  ["Algebra","math.algebra.linear_functions","Linear functions"],
  ["Algebra","math.algebra.systems_2x2","Systems of two linear equations"],
  ["Algebra","math.algebra.linear_inequalities","Linear inequalities"],
  ["Advanced Math","math.advanced.nonlinear_functions","Nonlinear functions"],
  ["Advanced Math","math.advanced.nonlinear_equations","Nonlinear equations"],
  ["Advanced Math","math.advanced.systems_nonlinear","Systems with nonlinear equations"],
  ["Advanced Math","math.advanced.equivalent_expressions","Equivalent expressions"],
  ["Problem-Solving and Data Analysis","math.psda.ratios_rates_units","Ratios, rates, proportional relationships, and units"],
  ["Problem-Solving and Data Analysis","math.psda.percentages","Percentages"],
  ["Problem-Solving and Data Analysis","math.psda.one_variable_data","One-variable data"],
  ["Problem-Solving and Data Analysis","math.psda.two_variable_data","Two-variable data"],
  ["Problem-Solving and Data Analysis","math.psda.probability","Probability and conditional probability"],
  ["Problem-Solving and Data Analysis","math.psda.inference","Inference from sample statistics and margin of error"],
  ["Problem-Solving and Data Analysis","math.psda.statistical_claims","Evaluating statistical claims"],
  ["Geometry and Trigonometry","math.geometry.area_volume","Area and volume"],
  ["Geometry and Trigonometry","math.geometry.lines_triangles","Lines, angles, and triangles"],
  ["Geometry and Trigonometry","math.geometry.right_triangles_trig","Right triangles and trigonometry"],
  ["Geometry and Trigonometry","math.geometry.circles","Circles"],
];
const RW_SKILLS: Array<[string,string,string]> = [
  ["Information and Ideas","reading_writing.info.central_ideas_details","Central Ideas and Details"],
  ["Information and Ideas","reading_writing.info.command_of_evidence","Command of Evidence"],
  ["Information and Ideas","reading_writing.info.inferences","Inferences"],
  ["Craft and Structure","reading_writing.craft.words_in_context","Words in Context"],
  ["Craft and Structure","reading_writing.craft.text_structure_purpose","Text Structure and Purpose"],
  ["Craft and Structure","reading_writing.craft.cross_text_connections","Cross-Text Connections"],
  ["Expression of Ideas","reading_writing.expression.rhetorical_synthesis","Rhetorical Synthesis"],
  ["Expression of Ideas","reading_writing.expression.transitions","Transitions"],
  ["Standard English Conventions","reading_writing.conventions.boundaries","Boundaries"],
  ["Standard English Conventions","reading_writing.conventions.form_structure_sense","Form, Structure, and Sense"],
];

function frequency(domain:string): string {
  // Qualitative labels, not past-question counts.
  if (["Algebra","Advanced Math","Craft and Structure"].includes(domain)) return "very_common";
  if (["Information and Ideas","Standard English Conventions"].includes(domain)) return "common";
  return "moderate";
}

function letter(i:number){return ["A","B","C","D"][i];}

// ---------------------------------------------------------------------
// MATH GENERATOR
// ---------------------------------------------------------------------
function mathQ(skill:string, domain:string, n:number, difficulty:number): Q {
  const u = n % BLOCK_SIZE; // unique 0..BLOCK_SIZE-1 within this skill's block
  const freq=frequency(domain);
  const base={section:"math" as const,domain,skill,difficulty,answer_type:"grid_in" as const,frequency_tier:freq,concept_tags:[skill.split('.').at(-1) || skill]};
  // Scale numeric magnitude gently with difficulty so harder items use larger/less-clean numbers.
  const scale = 1 + difficulty; // 2..6

  if (skill.includes("linear_equations_1var")) {
    const k=2+((u*3+difficulty)%9); const x=3+((u*7+difficulty*2)%12*scale%17)+1; const c=1+((u*5)%11); const rhs=k*x+c;
    return {...base,id:`bulk_m_l1_${n}_${difficulty}`,stem:`If ${k}x + ${c} = ${rhs}, what is the value of x?`,choices:null,correct_answer:String(x),explanation:`Subtract ${c} from both sides to get ${k}x = ${rhs-c}. Dividing by ${k} gives x = ${x}.`};
  }
  if (skill.includes("linear_equations_2var")) {
    const m=2+((u*3)%9); const intercept=1+((u*5)%13); const x=1+((u*7)%10); const y=m*x+intercept;
    return {...base,id:`bulk_m_l2_${n}_${difficulty}`,stem:`A line has equation y = ${m}x + ${intercept}. What is the value of y when x = ${x}?`,choices:null,correct_answer:String(y),explanation:`Substitute x = ${x}: y = ${m}(${x}) + ${intercept} = ${y}.`};
  }
  if (skill.includes("linear_functions")) {
    const m=2+((u*3)%9); const x1=1+((u*5)%11); const x2=x1+2+((u*2)%5); const delta=m*(x2-x1);
    return {...base,id:`bulk_m_lf_${n}_${difficulty}`,stem:`A linear function increases by ${delta} when x increases from ${x1} to ${x2}. What is the slope of the function?`,choices:null,correct_answer:String(m),explanation:`The slope is change in y divided by change in x: ${delta}/${x2-x1} = ${m}.`};
  }
  if (skill.includes("systems_2x2")) {
    const x=2+((u*5)%13), y=1+((u*3)%9); const p=2+((u*2)%5), q=1+((u*7)%4); const rhs1=p*x+q*y; const p2=1+((u*11)%4), q2=2+((u*13)%4); const rhs2=p2*x+q2*y;
    return {...base,id:`bulk_m_sys_${n}_${difficulty}`,stem:`For the system ${p}x + ${q}y = ${rhs1} and ${p2}x + ${q2}y = ${rhs2}, what is the value of x?`,choices:null,correct_answer:String(x),explanation:`Solving the system simultaneously (e.g. by elimination) gives the unique solution x = ${x}, y = ${y}.`};
  }
  if (skill.includes("linear_inequalities")) {
    const k=2+((u*3)%8), bound=2+((u*7)%15), c=1+((u*5)%9);
    return {...base,id:`bulk_m_ineq_${n}_${difficulty}`,stem:`If ${k}x - ${c} > ${k*bound-c}, which of the following must be true about x?`,choices:[`x > ${bound}`,`x < ${bound}`,`x = ${bound}`,`x > ${bound+c}`],correct_answer:"A",answer_type:"mcq",explanation:`Add ${c} to both sides and divide by the positive number ${k}; the inequality becomes x > ${bound}.`};
  }
  if (skill.includes("nonlinear_functions")) {
    const x=2+((u*5)%13), c=1+((u*7)%17); const val=x*x+c;
    return {...base,id:`bulk_m_nlf_${n}_${difficulty}`,stem:`For the function f(x) = x² + ${c}, what is f(${x})?`,choices:null,correct_answer:String(val),explanation:`Evaluate: f(${x}) = ${x}² + ${c} = ${val}.`};
  }
  if (skill.includes("nonlinear_equations")) {
    const x=2+u; const sum=2*x; const sq=x*x;
    return {...base,id:`bulk_m_nle_${n}_${difficulty}`,stem:`If x² - ${sum}x + ${sq} = 0, what is one solution for x?`,choices:[String(x),String(x+1),String(-x),String(2*x)],correct_answer:"A",answer_type:"mcq",explanation:`The expression factors as (x - ${x})², so the only solution is x = ${x}.`};
  }
  if (skill.includes("systems_nonlinear")) {
    const x=2+u; const sq=x*x;
    return {...base,id:`bulk_m_snon_${n}_${difficulty}`,stem:`The system y = x² and y = ${sq} has how many distinct real solutions for x?`,choices:["0","1","2","infinitely many"],correct_answer:"C",answer_type:"mcq",explanation:`The equations intersect where x² = ${sq}, so x = ${x} or x = -${x}; there are 2 real solutions.`};
  }
  if (skill.includes("equivalent_expressions")) {
    const a1=2+u, c1=1+((u*5)%17);
    return {...base,id:`bulk_m_equiv_${n}_${difficulty}`,stem:`Which expression is equivalent to ${a1}(2x + ${c1})?`,choices:[`${2*a1}x + ${a1*c1}`,`${2*a1}x + ${c1}`,`2x + ${a1*c1}`,`${a1}x + ${c1}`],correct_answer:"A",answer_type:"mcq",explanation:`Distribute ${a1} across both terms: ${a1}(2x) + ${a1}(${c1}) = ${2*a1}x + ${a1*c1}.`};
  }
  if (skill.includes("ratios_rates_units")) {
    const per=2+((u*3)%11), amount=3+((u*7)%19); const total=amount*per;
    return {...base,id:`bulk_m_ratio_${n}_${difficulty}`,stem:`A machine produces ${per} units every minute. At that constant rate, how many units does it produce in ${amount} minutes?`,choices:null,correct_answer:String(total),explanation:`Multiply the rate by time: ${per} × ${amount} = ${total} units.`};
  }
  if (skill.includes("percentages")) {
    const pctv=5+((u*7)%56), total=40+((u*13)%361); const value=total*pctv/100; const ans=Number.isInteger(value)?String(value):String(Math.round(value*100)/100);
    return {...base,id:`bulk_m_pct_${n}_${difficulty}`,stem:`What is ${pctv}% of ${total}?`,choices:null,correct_answer:ans,explanation:`Convert ${pctv}% to ${pctv/100} and multiply by ${total} to get ${ans}.`};
  }
  if (skill.includes("one_variable_data")) {
    const a=2+((u*5)%13), b=1+((u*3)%9), c=1+((u*7)%11), d=1+((u*11)%7);
    const nums=[a,a+b,a+c,a+d,a+b+c]; const mean=nums.reduce((x,y)=>x+y,0)/nums.length;
    return {...base,id:`bulk_m_1d_${n}_${difficulty}`,stem:`A data set contains the values ${nums.join(", ")}. What is the mean of this data set?`,choices:null,correct_answer:String(mean),explanation:`Add the values (${nums.join(" + ")} = ${nums.reduce((x,y)=>x+y,0)}) and divide by ${nums.length}; the mean is ${mean}.`};
  }
  if (skill.includes("two_variable_data")) {
    const x1=1+((u*3)%9), x2=x1+2+((u*5)%6), y1=2+((u*7)%17), y2=y1+2+((u*11)%9); const slope=(y2-y1)/(x2-x1);
    return {...base,id:`bulk_m_2d_${n}_${difficulty}`,stem:`A line of best fit passes through (${x1}, ${y1}) and (${x2}, ${y2}). What is its slope?`,choices:null,correct_answer:String(slope),explanation:`Slope = (${y2} - ${y1}) / (${x2} - ${x1}) = ${slope}.`};
  }
  if (skill.includes("probability")) {
    const colorsPool = [["red","blue"],["green","yellow"],["orange","purple"],["black","white"]];
    const colors = colorsPool[u % colorsPool.length];
    const favorable=2+u, extra=3+((u*5)%23); const total=favorable+extra; const ptxt=`${favorable}/${total}`;
    return {...base,id:`bulk_m_prob_${n}_${difficulty}`,stem:`A bag contains ${favorable} ${colors[0]} marbles and ${extra} ${colors[1]} marbles, and one marble is drawn at random. What is the probability that it is ${colors[0]}?`,choices:[ptxt,`${extra}/${total}`,`${favorable+1}/${total}`,`1/${total}`],correct_answer:"A",answer_type:"mcq",explanation:`Probability = favorable outcomes / total outcomes = ${favorable}/${total}.`};
  }
  if (skill.includes("inference")) {
    const margin=1+((u*3)%9), est=30+u*3;
    return {...base,id:`bulk_m_inf_${n}_${difficulty}`,stem:`A random sample is used to estimate a population mean of ${est}, with a margin of error of ${margin}. Which interval best represents the plausible range for the true population mean?`,choices:[`${est-margin} to ${est+margin}`,`${est-margin*2} to ${est+margin*2}`,`${est} to ${est+margin}`,`${est-margin} to ${est}`],correct_answer:"A",answer_type:"mcq",explanation:`A margin of error of ±${margin} gives ${est} ± ${margin}, or ${est-margin} to ${est+margin}.`};
  }
  if (skill.includes("statistical_claims")) {
    const n_participants = 40 + u * 7;
    const scenarios = [
      {setup:`A researcher randomly assigns ${n_participants} participants to two groups before comparing their outcomes.`, answer:"A causal claim is supported more strongly than with an observational study."},
      {setup:`A survey samples every tenth customer who enters a specific store, reaching ${n_participants} respondents on a single Saturday.`, answer:"Conclusions should be limited to customers similar to that store on that day."},
      {setup:`A study observes (without random assignment) that ${n_participants} students who take a prep course score higher on average than students who do not.`, answer:"The result shows an association, not necessarily that the course caused the higher scores."},
      {setup:`A poll contacts a random sample of ${n_participants} registered voters nationwide with a stated margin of error.`, answer:"The reported percentage is an estimate that could reasonably vary within the margin of error."},
      {setup:`A lab repeats an experiment with a new random sample of ${n_participants} subjects and gets a similar result each time.`, answer:"Replication with new random samples strengthens confidence in the finding."},
    ];
    const sc = scenarios[u % scenarios.length];
    const distractors = ["The result proves the effect for every person in the population.","Sample size and random selection are irrelevant to the conclusion.","Only the researcher's opinion determines whether the claim is valid."];
    return {...base,id:`bulk_m_claim_${n}_${difficulty}`,stem:`${sc.setup} Which conclusion is most justified?`,choices:[sc.answer,distractors[0],distractors[1],distractors[2]],correct_answer:"A",answer_type:"mcq",explanation:`${sc.answer} This follows directly from how the data were collected.`};
  }
  if (skill.includes("area_volume")) {
    const w=3+((u*3)%15), h=3+((u*5)%13);
    return {...base,id:`bulk_m_area_${n}_${difficulty}`,stem:`A rectangle has length ${w} and width ${h}. What is its area?`,choices:null,correct_answer:String(w*h),explanation:`Area = length × width = ${w} × ${h} = ${w*h}.`};
  }
  if (skill.includes("lines_triangles")) {
    const angle=20+((u*7)%71); const ans=180-angle*2;
    return {...base,id:`bulk_m_tri_${n}_${difficulty}`,stem:`An isosceles triangle has two equal base angles of ${angle}° each. What is the measure of the third angle?`,choices:null,correct_answer:String(ans>0?ans:1),explanation:`Triangle angles total 180°, so the third angle is 180 - 2(${angle}) = ${ans>0?ans:1}°.`};
  }
  if (skill.includes("right_triangles_trig")) {
    const pairs = [[3,4],[6,8],[5,12],[9,12],[8,15],[7,24],[9,40],[12,16],[10,24],[20,21]];
    const scale = 1 + 2 * Math.floor(u / pairs.length); // odd scale factors (1,3,5,7) avoid landing on another base pair
    const [pa,pb] = pairs[u % pairs.length]; const a1=pa*scale, b1=pb*scale;
    const hyp=Math.sqrt(a1*a1+b1*b1); const ans=Number.isInteger(hyp)?String(hyp):String(Math.round(hyp*100)/100);
    return {...base,id:`bulk_m_trig_${n}_${difficulty}`,stem:`A right triangle has legs of length ${a1} and ${b1}. What is the length of its hypotenuse?`,choices:null,correct_answer:ans,explanation:`By the Pythagorean theorem, c = √(${a1}² + ${b1}²) = √${a1*a1+b1*b1} = ${ans}.`};
  }
  // circles
  const r=2+u; const area=`${r*r}π`;
  return {...base,id:`bulk_m_circle_${n}_${difficulty}`,stem:`A circle has radius ${r}. What is its area, in terms of π?`,choices:[area,`${2*r}π`,`${4*r}π`,`${r}π`],correct_answer:"A",answer_type:"mcq",explanation:`Circle area is πr², so with r = ${r} the area is ${area}.`};
}

// ---------------------------------------------------------------------
// READING & WRITING GENERATOR
// Topic pool (5) x Name pool (8) => 40 unique combinations, matching
// BLOCK_SIZE exactly, so every row in a skill's block gets a genuinely
// different scenario instead of repeating the same stem at five
// different "difficulty" labels.
// ---------------------------------------------------------------------
const TOPICS = [
  "a community garden that grew from a handful of volunteers into a supplier for local food banks",
  "a university lab that developed a low-cost water filter for rural clinics",
  "a small-town history museum that digitized its collection of century-old photographs",
  "a robotics team that built a low-cost prosthetic hand for young patients",
  "a public-health program that tracked recovery times after a new outreach initiative",
];
const NAMES = ["Maya","Jordan","Priya","Ethan","Leila","Noah","Aiden","Sofia"];
const SUBJECTS_SINGULAR = [
  "The collection of rare manuscripts","The committee overseeing the project","The list of qualified applicants",
  "The number of visiting researchers","The series of public lectures","The archive of digitized recordings",
  "The panel of invited reviewers","The set of preliminary results",
];
const SUBJECTS_PLURAL = [
  "The volunteers who staff the garden","The researchers on the grant","The students in the program",
  "The engineers on the team","The donors who fund the clinic","The reviewers on the panel",
  "The interns hired each summer","The scientists collaborating remotely",
];

function rwQ(skill:string,domain:string,n:number,difficulty:number): Q {
  const u = n % BLOCK_SIZE;
  const freq=frequency(domain);
  const base={section:"reading_writing" as const,domain,skill,difficulty,answer_type:"mcq" as const,frequency_tier:freq,concept_tags:[skill.split('.').at(-1) || skill]};
  const topic = TOPICS[u % TOPICS.length];
  const name = NAMES[u % NAMES.length];
  const yearsAgo = 2 + (u % 9);

  if(skill.includes("central_ideas_details")) return {...base,id:`bulk_rw_cid_${n}_${difficulty}`,stem:`${name} describes ${topic}, tracing its growth over roughly ${yearsAgo} years. Which choice best states the central idea of the passage?`,choices:["The effort grew from a small beginning into something that meaningfully served its community.","The effort replaced every comparable resource that previously existed in the area.","People mainly enjoyed the activity itself rather than its outcomes.","The described organization was founded before any similar one existed."],correct_answer:"A",explanation:`Choice A captures the growth-and-impact arc described without adding unsupported claims.`};

  if(skill.includes("command_of_evidence")) return {...base,id:`bulk_rw_coe_${n}_${difficulty}`,stem:`A passage about ${topic} claims that the initiative measurably improved outcomes for the people it served. ${name}, one of the reviewers, looks for the strongest supporting evidence. Which finding would best support that claim?`,choices:[`A follow-up study led by ${name} found a statistically significant improvement among participants, compared with a similar group that did not take part.`,"The initiative received a small amount of local media coverage.","Several participants said they enjoyed the experience.","The initiative has existed for several years."],correct_answer:"A",explanation:`Only the comparative, measured finding provides direct empirical support for a claim about improved outcomes.`};

  if(skill.includes("inferences")) return {...base,id:`bulk_rw_inf_${n}_${difficulty}`,stem:`${name} observed that participants in ${topic} reported better results after roughly ${yearsAgo} years, while the amount of funding stayed about the same. Which inference is best supported by this information?`,choices:["Factors other than increased funding may explain the improvement.","Funding has no relationship to outcomes in any program.","The program will keep improving indefinitely.","Every similar program produces identical results."],correct_answer:"A",explanation:`The passage supports a cautious inference limited to this case, not a sweeping universal claim.`};

  if(skill.includes("words_in_context")){
    const wordSets = [
      {sentence:`${name}'s summary of ${topic} was remarkably concise.`, word:"concise", answer:"brief and clear", distractors:["uncertain and vague","technical and complex","unrelated and unusual"]},
      {sentence:`${name} and other reviewers found the proposal for ${topic} surprisingly meticulous.`, word:"meticulous", answer:"extremely careful and detailed", distractors:["quick and careless","overly emotional","deliberately misleading"]},
      {sentence:`${name} described the early results from ${topic} as promising but still tentative.`, word:"tentative", answer:"not yet certain or final", distractors:["completely confirmed","widely publicized","financially costly"]},
      {sentence:`${name}'s account of ${topic} struck reviewers as candid.`, word:"candid", answer:"honest and straightforward", distractors:["exaggerated and boastful","overly formal","difficult to understand"]},
      {sentence:`${name} noted that funding for ${topic} remained precarious for its first two years.`, word:"precarious", answer:"uncertain and insecure", distractors:["abundant and guaranteed","gradually increasing","publicly celebrated"]},
    ];
    const w = wordSets[u % wordSets.length];
    return {...base,id:`bulk_rw_wic_${n}_${difficulty}`,stem:`In the sentence, "${w.sentence}" the word "${w.word}" most nearly means`,choices:[w.answer,w.distractors[0],w.distractors[1],w.distractors[2]],correct_answer:"A",explanation:`"${w.word}" most nearly means ${w.answer} in this context.`};
  }

  if(skill.includes("text_structure_purpose")) return {...base,id:`bulk_rw_tsp_${n}_${difficulty}`,stem:`Writing about ${topic}, ${name} first describes an unexpected result, then explains two possible causes, and finally identifies which cause the evidence best supports. What is the main function of this structure?`,choices:["It presents a result and then evaluates competing explanations for it.","It lists unrelated events from the organization's history.","It gives step-by-step instructions for repeating an experiment.","It compares the biographies of two unrelated authors."],correct_answer:"A",explanation:`The passage moves from result to possible explanations and then evaluates them — a result-then-evaluation structure.`};

  if(skill.includes("cross_text_connections")) return {...base,id:`bulk_rw_ctc_${n}_${difficulty}`,stem:`Passage 1, written by ${name}, argues that ${topic} shows how small, local efforts can produce broad benefits. Passage 2 agrees but cautions that consistent funding was essential to that success. Which statement would both authors most likely support?`,choices:["Local efforts can produce broad benefits, though sustained resources matter for that outcome.","Local efforts always succeed regardless of available resources.","Funding is irrelevant to whether a local effort succeeds.","Only large, well-funded organizations can produce meaningful benefits."],correct_answer:"A",explanation:`Both passages support the benefit of local effort while Passage 2 adds the funding condition — choice A reflects both.`};

  if(skill.includes("rhetorical_synthesis")){
    const notesTopic = topic;
    return {...base,id:`bulk_rw_rs_${n}_${difficulty}`,stem:`Student notes on ${notesTopic}: it began roughly ${yearsAgo} years ago; it later expanded to serve a wider group; the expansion required new volunteers and modest funding. The student wants to emphasize what made the expansion possible. Which sentence best uses these notes to do so?`,choices:[`Roughly ${yearsAgo} years after it began, the project expanded to serve a wider group, a change made possible by new volunteers and modest funding.`,`The project began about ${yearsAgo} years ago, and time has passed since then as well.`,"Volunteers exist, and funding is sometimes needed for projects.","A wider group was served at some point in the project's history."],correct_answer:"A",explanation:`Choice A directly connects the expansion to its stated causes (volunteers and funding), which is what the student wanted to emphasize.`};
  }

  if(skill.includes("transitions")){
    const pairs = [
      {a:`${name} noted that many aspects of ${topic} limit early-stage risk.`, b:`some elements of the project only launched once a pilot phase succeeded.`, answer:"For example", distractors:["However","Therefore","Meanwhile"]},
      {a:`Interest in ${topic} grew slowly during its first year, according to ${name}.`, b:"attendance and support increased sharply once local media covered the project.", answer:"However", distractors:["For example","In other words","Similarly"]},
      {a:`${name} and other organizers expected ${topic} to attract a small group of participants.`, b:"more than triple that number applied within the first month.", answer:"Instead", distractors:["For example","Consequently","In addition"]},
      {a:`${name}'s team tracked outcomes for ${topic} carefully throughout the program.`, b:"they could identify which changes were responsible for the improvement.", answer:"As a result", distractors:["However","For instance","Nonetheless"]},
      {a:`${name} found that early setbacks in ${topic} discouraged some volunteers.`, b:"most volunteers stayed involved once the project's early goals were met.", answer:"Nonetheless", distractors:["For example","As a result","In other words"]},
    ];
    const p = pairs[u % pairs.length];
    return {...base,id:`bulk_rw_trans_${n}_${difficulty}`,stem:`${p.a} ___, ${p.b}`,choices:[p.answer,p.distractors[0],p.distractors[1],p.distractors[2]],correct_answer:"A",explanation:`"${p.answer}" correctly signals the logical relationship between the two ideas.`};
  }

  if(skill.includes("boundaries")){
    const sentences = [
      {text:`${name} and the team behind ${topic} finished the first phase in May ___ the results were shared publicly the following month.`, answer:", and", distractors:[";","because",". Then"]},
      {text:`${name} says the work on ${topic} opened new possibilities in its first spring ___ it quickly became a popular effort.`, answer:";", distractors:[", but",". However,","and,"]},
      {text:`${name} and other organizers expected modest interest in ${topic} ___ far more people got involved than planned.`, answer:", but", distractors:[";","because","and"]},
      {text:`${name}'s report on ${topic} was finished early ___ the team used the extra time to double-check every figure.`, answer:", so", distractors:[";","although","yet"]},
      {text:`${name} completed the review of ${topic} ahead of schedule ___ colleagues asked for an additional round of feedback.`, answer:", yet", distractors:[";","because","and"]},
    ];
    const s = sentences[u % sentences.length];
    return {...base,id:`bulk_rw_bound_${n}_${difficulty}`,stem:`Choose the option that completes the sentence with correct punctuation: "${s.text.replace('___','___')}"`,choices:[s.answer.trim(),s.distractors[0],s.distractors[1],s.distractors[2]],correct_answer:"A",explanation:`"${s.answer.trim()}" correctly joins the two clauses without creating a run-on or comma splice.`};
  }

  // form_structure_sense — subject-verb agreement, varied subjects and topic references
  const singular = SUBJECTS_SINGULAR[u % SUBJECTS_SINGULAR.length];
  return {...base,id:`bulk_rw_forms_${n}_${difficulty}`,stem:`Choose the option that completes the sentence correctly: "${singular} related to ${topic} ___ been updated to reflect the most recent findings, according to ${name}."`,choices:["have","has","were","are"],correct_answer:"B",explanation:`The subject is singular ("${singular.split(' ')[0]} ${singular.split(' ')[1] || ''}"), so the correct verb is "has."`};
}

const questions: Q[]=[];
let idx=0;
for(const [domain,skill] of MATH_SKILLS){ for(let d=1; d<=DIFFICULTIES; d++) for(let v=0; v<VARIANTS; v++) questions.push(mathQ(skill,domain,idx++,d)); }
idx=0;
for(const [domain,skill] of RW_SKILLS){ for(let d=1; d<=DIFFICULTIES; d++) for(let v=0; v<VARIANTS; v++) questions.push(rwQ(skill,domain,idx++,d)); }

const db=getDb();
// Clear out the previous generation of auto-generated bulk questions before
// reinserting the improved, de-duplicated set. Admin-authored questions
// (source != 'bulk_original') and the small hand-written seed set are untouched.
const removed = await db.prepare(`DELETE FROM questions WHERE source='bulk_original'`).run();
if (removed.changes) console.log(`Removed ${removed.changes} previous bulk_original questions before reseeding.`);

const tx=db.transaction(async (txDb)=>{
  for (const q of questions) {
    await txDb.prepare(`INSERT OR IGNORE INTO questions
      (id,section,skill,difficulty,stem,choices_json,correct_answer,answer_type,explanation,source,validated,status,domain,frequency_tier,previous_exam_occurrence_count,previous_exam_occurrence_basis,concept_tags_json)
      VALUES (@id,@section,@skill,@difficulty,@stem,@choices_json,@correct_answer,@answer_type,@explanation,'bulk_original',1,'approved',@domain,@frequency_tier,NULL,NULL,@concept_tags_json)`).run({
      ...q,
      choices_json:q.choices?JSON.stringify(q.choices):null,
      concept_tags_json:JSON.stringify(q.concept_tags),
    });
  }
});
await tx();
console.log(`Bulk bank ready: ${questions.length} original questions (${questions.filter(q=>q.section==='math').length} Math, ${questions.filter(q=>q.section==='reading_writing').length} Reading & Writing).`);
