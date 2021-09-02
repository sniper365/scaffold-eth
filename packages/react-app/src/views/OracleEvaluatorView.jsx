import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import Safe, { EthersAdapter, SafeFactory, SafeTransaction, TransactionOptions } from "@gnosis.pm/safe-core-sdk";
import { Typography, Button, Row, Divider } from "antd";
import SafeServiceClient from "@gnosis.pm/safe-service-client";
import { ColumnWidthOutlined } from "@ant-design/icons";
import { TransactionDescription } from "ethers/lib/utils";
import { EthSignSignature } from "./EthSignSignature";
import { useParams } from "react-router-dom";

const { Title, Text } = Typography;
const serviceClient = new SafeServiceClient("https://safe-transaction.rinkeby.gnosis.io/");

export default function OracleEvaluatorView({ userAddress, userSigner }) {
  const { safeAddress } = useParams();
  console.log("address of safe: " + safeAddress);
  const [evaluators, setEvaluators] = useState([]);
  const [workString, setWorkString] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [yesTransaction, setYesTransaction] = useState({});
  const [noTransaction, setNoTransaction] = useState({});
  const [threshold, setThreshold] = useState();
  const [safeSdk, setSafeSdk] = useState();
  const [safeLoaded, setSafeLoaded] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(async () => {
    if (userSigner) {
      const ethAdapter = new EthersAdapter({ ethers, signer: userSigner });
      const id = await ethAdapter.getChainId();
      const contractNetworks = {
        [id]: {
          multiSendAddress: safeAddress,
          safeMasterCopyAddress: safeAddress,
          safeProxyFactoryAddress: safeAddress,
        },
      };
      const safeSdk = await Safe.create({ ethAdapter, safeAddress, contractNetworks });
      setSafeSdk(safeSdk);
    }
  }, [userSigner]);

  useEffect(async () => {
    if (!safeLoaded) {
      const safeInfo = await serviceClient.getSafeCreationInfo(safeAddress);
      console.log("safeInfo:");
      console.log(safeInfo);
      setEvaluators(safeInfo.dataDecoded.parameters.find(item => item.name === "_owners").value);
      setThreshold(safeInfo.dataDecoded.parameters.find(item => item.name === "_threshold").value);
      console.log(evaluators);
      const deployer = safeInfo.creator.toLowerCase();
      console.log("deployer: " + deployer);
      const { results } = await serviceClient.getPendingTransactions(safeAddress);
      console.log("pending transactions:");
      console.log(results);
      if (results.length < 2) {
        setDone(true);
      }
      const transaction = results.find(data => data.to.toLowerCase() === deployer);
      console.log("the transactio");
      console.log(transaction);
      const yesTrans = results.find(_ => _.to.toLowerCase() !== deployer);
      const noTrans = results.find(_ => _.to.toLowerCase() === deployer);
      setYesTransaction(yesTrans);
      setNoTransaction(noTrans);
      if (yesTrans != null) {
        setWorkString(ethers.utils.toUtf8String(yesTrans.data));
        setBeneficiary(yesTrans.to);
      }
      setSafeLoaded(true);
    }
  });

  const signTransaction = async transaction => {
    const hash = transaction.safeTxHash;
    const signature = await safeSdk.signTransactionHash(hash);
    await serviceClient.confirmTransaction(hash, signature.data);
    console.log("Signed the transaction!");
    setSafeLoaded(false);
  };

  const executeTransaction = async transaction => {
    console.log(transaction);
    const safeTransactionData = {
      to: transaction.to,
      value: transaction.value,
      data: transaction.data || "0x",
      operation: transaction.operation,
      safeTxGas: transaction.safeTxGas,
      baseGas: transaction.baseGas,
      gasPrice: Number(transaction.gasPrice),
      gasToken: transaction.gasToken,
      refundReceiver: transaction.refundReceiver,
      nonce: transaction.nonce,
    };
    const safeTransaction = await safeSdk.createTransaction(safeTransactionData);
    transaction.confirmations.forEach(confirmation => {
      safeTransaction.addSignature(new EthSignSignature(confirmation.owner, confirmation.signature));
    });
    const executeTxResponse = await safeSdk.executeTransaction(safeTransaction);
    const receipt = executeTxResponse.transactionResponse && (await executeTxResponse.transactionResponse.wait());
    console.log(receipt);
  };

  const addressHasSigned = address =>
    [yesTransaction, noTransaction].reduce(
      (acc, transaction) => acc || transaction.confirmations.map(_ => _.owner).includes(address),
      false,
    );

  const getExecutableTransaction = () => {
    if (yesTransaction.confirmations.length >= threshold) {
      return yesTransaction;
    } else if (noTransaction.confirmations.length >= threshold) {
      return noTransaction;
    }
    return false;
  };

  const Transaction = transaction => (
    <div>
      <Text key={transaction.safeTxHash}>{transaction.safeTxHash}</Text>
    </div>
  );

  return (
    <div style={{ border: "1px solid #cccccc", padding: 16, width: 800, margin: "auto", marginTop: 64 }}>
      <div style={{ padding: 50 }}>
        <Title level={1}>Evaluator</Title>
        {done ? (
          <Title lever={1}>Concluded! Nothing to see here!</Title>
        ) : (
          <>
            <Title level={4}>Did {beneficiary} complete the work stated below?</Title>
            <Title level={2}>{workString}</Title>
            {safeLoaded ? (
              getExecutableTransaction() ? (
                <Button onClick={() => executeTransaction(getExecutableTransaction())}>Execute</Button>
              ) : evaluators.includes(userAddress) ? (
                addressHasSigned(userAddress) ? (
                  <Text>You have already answered this</Text>
                ) : (
                  <div>
                    <Button onClick={() => signTransaction(yesTransaction)}>Yes</Button>
                    <Button onClick={() => signTransaction(noTransaction)}>No</Button>
                  </div>
                )
              ) : (
                <div>
                  <Text>You are not a evaluator.</Text>
                </div>
              )
            ) : (
              <Text>Loading</Text>
            )}
          </>
        )}
      </div>
    </div>
  );
}
