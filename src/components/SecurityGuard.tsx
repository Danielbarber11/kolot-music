import React from 'react';

interface SecurityGuardProps {
  children: React.ReactNode;
}

export const SecurityGuard: React.FC<SecurityGuardProps> = ({ children }) => {
  return <>{children}</>;
};
