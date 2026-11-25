const NO_ANSWER = "I couldn't find an answer in the available information. Please rephrase your question or contact support.";
const STOP_WORDS = new Set('a an the i my me we our you your is are was were be been do does did can could would should how what where when why to for of in on at and or it this that please some'.split(' '));

function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function terms(text) {
  return [...new Set(normalize(text).split(' ').filter(word => word.length >= 3 && !STOP_WORDS.has(word)))];
}


module.exports = { normalize, terms, NO_ANSWER };
