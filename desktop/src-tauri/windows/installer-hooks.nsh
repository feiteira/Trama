; "Trama (example)" in the Start menu: the same program with --example, which opens a
; fictional research project that resets at every start. Named in the language chosen for
; the install.

Var TramaExampleLnk

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $TramaExampleLnk "Trama (example)"
  ${If} $LANGUAGE == 2070
    StrCpy $TramaExampleLnk "Trama (exemplo)"
  ${ElseIf} $LANGUAGE == 1034
    StrCpy $TramaExampleLnk "Trama (ejemplo)"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\$TramaExampleLnk.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--example"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Trama (example).lnk"
  Delete "$SMPROGRAMS\Trama (exemplo).lnk"
  Delete "$SMPROGRAMS\Trama (ejemplo).lnk"
!macroend
