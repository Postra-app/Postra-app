// Style imports carry no behaviour worth testing, and Jest cannot parse CSS.
// Without this, any test that reaches a module importing a font stylesheet
// fails to parse rather than fails an assertion.
module.exports = {};
