// Get the monthly payment amount for a new loan
// https://codepen.io/joeymack47/pen/fHwvd?editors=1010
export function getMonthlyPayment(principlal: number, interestRate: number, months: number): number {
  const monthlyRate = interestRate / 12;
  return principlal * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
}

// For a given monthly payment, return how many $'s go towards paying off the interest (the rest goes towards principal)
export function getPaymentInterest(balance: number, interestRate: number, monthlyPayment: number): number {
  const monthlyRate = interestRate / 12;
  return balance * monthlyRate;
}