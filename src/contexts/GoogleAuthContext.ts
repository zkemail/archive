import { createContext } from 'react';

type GoogleAuthToken = {
  access_token: string;
  scope: string;
  token_type: string;
  expires_in: number;
};

interface GoogleAuthValues {
  googleAuthToken: GoogleAuthToken | null;
  isGoogleAuthed: boolean;
  loggedInGmail: string | null;
  scopesApproved: boolean;
  googleLogIn: (cb: () => void) => () => void;
  googleLogOut: () => void;
}

const defaultValues: GoogleAuthValues = {
  googleAuthToken: null,
  isGoogleAuthed: false,
  loggedInGmail: null,
  scopesApproved: false,
  googleLogIn: () => () => {},
  googleLogOut: () => {},
};

const GoogleAuthContext = createContext<GoogleAuthValues>(defaultValues);

export default GoogleAuthContext;
