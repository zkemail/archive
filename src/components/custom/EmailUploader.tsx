/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import useGoogleAuth from "@/hooks/useGoogleAuth";
import { useEffect, useState } from "react";
import DragAndDropFile from "./DragAndDropFile";
import { RawEmailResponse } from "@/hooks/useGmailClient";
import { fetchEmailList, fetchEmailsRaw } from "@/hooks/useGmailClient";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AnimatePresence, motion } from "framer-motion";
import Loader from "@/components/ui/loader";
import { decodeMimeEncodedText, formatDate, getFileContent } from "@/lib/utils";

const EmailUploader = ({
  onFileUpload,
}: {
  onFileUpload: (file: File) => void;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fetchedEmails, setFetchedEmails] = useState<RawEmailResponse[]>([]);
  const [isFetchEmailLoading, setIsFetchEmailLoading] = useState(false);
  const [pageToken, setPageToken] = useState<number | null>(null);
  const [emailQuery, setEmailQuery] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<RawEmailResponse | null>(
    null
  );
  const [emailContent, setEmailContent] = useState<string | null>(null);

  const { googleLogIn, googleAuthToken } = useGoogleAuth();

  useEffect(() => {
    const checkFileValidity = async (file: File | null) => {
      if (!file) return;
      const content = await getFileContent(file);
      if (content) {
        const subject = content.match(/Subject: (.*)/)?.[1] || "No Subject";

        const selectedEmail = {
          emailMessageId: "uploadedFile",
          subject,
          internalDate: (() => {
            const dateMatches = content.match(/Date: (.*)/g); // Find all "Date:" occurrences
            if (dateMatches && dateMatches.length > 0) {
              const lastDateMatch = dateMatches[dateMatches.length - 1]; // Take the last match
              const dateValue = lastDateMatch.split("Date: ")[1]; // Extract the actual date string
              return new Date(dateValue).toISOString(); // Convert to ISO format
            }
            return "Invalid Date";
          })(),
          decodedContents: content,
        };

        setFetchedEmails([selectedEmail]);
      }
    };

    checkFileValidity(file);
  }, [file]);

  const handleFetchEmails = async () => {
    if (!googleAuthToken) return;

    try {
      setIsFetchEmailLoading(true);
      const emailListResponse = await fetchEmailList(
        googleAuthToken?.access_token,
        {
          pageToken: pageToken || undefined,
          q: emailQuery || undefined,
        }
      );

      const emailResponseMessages = emailListResponse.messages;
      if (emailResponseMessages?.length > 0) {
        const emailIds = emailResponseMessages.map((message) => message.id);
        const emails = await fetchEmailsRaw(
          googleAuthToken?.access_token,
          emailIds
        );

        if (emails.length === 0 && emailListResponse.nextPageToken) {
          setPageToken(Number(emailListResponse.nextPageToken) || null);
          handleFetchEmails();
          return;
        }

        setFetchedEmails([...fetchedEmails, ...emails]);

        setPageToken(Number(emailListResponse.nextPageToken) || null);
      } else {
        setFetchedEmails([]);
      }
    } catch (error) {
      console.error("Error in fetching data:", error);
    } finally {
      setIsFetchEmailLoading(false);
    }
  };

  useEffect(() => {
    if (googleAuthToken?.access_token) {
      handleFetchEmails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAuthToken]);

  const emailUploadOptions = (
    <div className="flex flex-col items-center justify-center gap-6">
      <div className="flex w-full flex-col gap-1">
        <h4 className="text-xl font-bold text-grey-800">Connect emails</h4>
        <p className="text-base font-medium text-grey-700">
          Connect your Gmail or upload an .eml file
        </p>
        <p className="text-base font-medium text-grey-700">
          <span className="font-bold text-grey-900">Note:</span> All email
          processing occurs locally on your device. We never receive or store
          your email data.
        </p>
      </div>
      <Button
        className="flex w-max items-center gap-2"
        onClick={googleLogIn(() => {
          setIsFetchEmailLoading(true);
          // setTimeout(() => {
          //   handleFetchEmails();
          // }, 2000);

          // handleFetchEmails();
          setFile(null);
        })}
      >
        <Image
          src="/assets/GoogleLogo.svg"
          alt="Google Logo"
          width={16}
          height={16}
          style={{
            maxWidth: "100%",
            height: "auto",
          }}
        />
        Connect Gmail Account
      </Button>
      <div className="flex w-full items-center">
        <Separator className="flex-1" />
        <span className="mx-3 text-base font-semibold text-grey-700">OR</span>
        <Separator className="flex-1" />
      </div>
      <DragAndDropFile
        accept=".eml"
        file={file}
        tooltipComponent={
          <div className="w-[380px] rounded-2xl border border-grey-500 bg-white p-2">
            <Image
              src="/assets/emlInfo.svg"
              alt="emlInfo"
              width={360}
              height={80}
            />
            <p className="mt-3 text-base font-medium text-grey-700">
              The test .eml file is a sample email used to check if all the
              provided patterns (regex) work correctly. This helps confirm
              everything is set up properly before blueprint creation. We always
              store this file locally and never send it to our server.
            </p>
          </div>
        }
        setFile={async (e) => {
          if (!e) return;
          setFile(e);
          onFileUpload(e);
        }}
      />
    </div>
  );

  const renderEmailsTable = () => {
    if (isFetchEmailLoading) {
      return (
        <div className="mt-6 flex w-full justify-center">
          <Loader />
        </div>
      );
    }

    return (
      <div className="mt-6 w-[640px] border border-grey-500 rounded-2xl p-6">
        <Button
          variant="ghost"
          startIcon={
            <Image
              src="/assets/ArrowLeft.svg"
              alt="arrow left"
              width={16}
              height={16}
            />
          }
          onClick={() => {
            setFile(null);
            setFetchedEmails([]);
            setSelectedEmail(null);
            setEmailContent(null);
          }}
        >
          Back
        </Button>
        <div className="grid w-full">
          {/* Header */}
          <div
            className="mb-2 grid gap-6 text-left font-semibold"
            style={{ gridTemplateColumns: "1fr 2fr 6fr" }}
          >
            <div className="text-left">Select</div>
            <div>Sent on</div>
            <div>Subject</div>
          </div>

          {/* Rows */}
          <RadioGroup
            onValueChange={(value) => {
              setSelectedEmail(
                fetchedEmails.find(
                  (email) => email.decodedContents === value
                ) || null
              );

              setEmailContent(value);
            }}
          >
            <AnimatePresence initial={false}>
              {fetchedEmails.map((email) => (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  key={email.emailMessageId}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="grid items-center gap-6 border-t-2 border-neutral-100 py-3 text-grey-700"
                  style={{ gridTemplateColumns: "1fr 2fr 6fr" }}
                >
                  <RadioGroupItem
                    value={email.decodedContents}
                    id={email.emailMessageId}
                    // disabled={!email.valid}
                  />
                  <div>
                    <div>{formatDate(email.internalDate).split(",")[0]}</div>
                    <div>{formatDate(email.internalDate).split(",")[1]}</div>
                  </div>
                  <div className="overflow-hidden text-ellipsis">
                    {decodeMimeEncodedText(email.subject)}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </RadioGroup>
        </div>
        <div className="mt-6 flex w-full flex-col items-center gap-4">
          <Button
            variant="ghost"
            className="gap-2 text-grey-700"
            onClick={handleFetchEmails}
            disabled={isFetchEmailLoading}
          >
            <Image
              src="/assets/ArrowsClockwise.svg"
              alt="arrow down"
              width={16}
              height={16}
              className={isFetchEmailLoading ? "animate-spin" : ""}
              style={{
                maxWidth: "100%",
                height: "auto",
              }}
            />
            Load More Emails
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {isFetchEmailLoading && !fetchedEmails.length ? (
        <div>
          <Loader />
        </div>
      ) : fetchedEmails.length > 0 ? (
        renderEmailsTable()
      ) : (
        emailUploadOptions
      )}
    </div>
  );
};

export default EmailUploader;
