import aztec from 'aztec.js';
import Web3Service from '../../helpers/Web3Service';
import AuthService from '../../helpers/AuthService';
import CurrencyService from '../../helpers/CurrencyService';
import {
  restoreFromSharedSecret,
  approveNoteAccess,
  signNote,
  mintNote,
} from '../note';

export default async function settleLoan({
  loanAddress,
  borrower,
  amount,
  currencyId,
  sharedSecret,
}) {
  const publicKey = await AuthService.getPublicKey();

  const currencyContractAddress = CurrencyService.getZKAddress(currencyId);
  const settlementNote = await mintNote({
    amount,
    currencyContractAddress,
  });

  const {
    noteHash: settlementNoteHash,
  } = settlementNote.exportNote();

  const settlementSignature = await signNote({
    validatorAddress: currencyContractAddress,
    noteHash: settlementNoteHash,
    spender: loanAddress,
  });

  await Web3Service.useContract('ZKERC20')
    .at(currencyContractAddress)
    .method('confidentialApprove')
    .send(
      settlementNoteHash,
      loanAddress,
      true,
      settlementSignature,
    );

  const originalNote = await restoreFromSharedSecret(sharedSecret);
  originalNote.owner = borrower.address;
  const loanBalanceNote = await aztec.note.create(borrower.publicKey, amount, loanAddress);
  const settlementAskNote = await aztec.note.create(publicKey, amount);

  const takerBid = originalNote;
  const takerAsk = loanBalanceNote;
  const makerBid = settlementNote;
  const makerAsk = settlementAskNote;
  const {
    proofData: bilateralSwapProofData,
  } = aztec.proof.bilateralSwap.encodeBilateralSwapTransaction({
    inputNotes: [takerBid, takerAsk],
    outputNotes: [makerAsk, makerBid],
    senderAddress: loanAddress,
  });
  const {
    noteHash: notionalAskNoteHash,
  } = loanBalanceNote.exportNote();

  await Web3Service.useContract('LoanDapp')
    .method('settleInitialBalance')
    .send(
      loanAddress,
      bilateralSwapProofData,
      notionalAskNoteHash,
    );

  await approveNoteAccess({
    note: loanBalanceNote,
    shareWith: borrower,
  });

  return amount;
}
