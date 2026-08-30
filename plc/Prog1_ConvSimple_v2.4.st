PROGRAM Prog1
#info= QLD
BOF


(**)

SOR  [0,1] (**) (**)  XIC  [1,0] (*_IO_EM_DI_02*) (*estop_nc*)  XIO  [2,0] (*_IO_EM_DI_03*) (*estop_no*)  OTE  [3,0] (*e_stop_ok*) (**)
EOR [4,0]


(**)

SOR  [0,3] (**) (**)  XIO  [1,0] (*_IO_EM_DI_02*) (*estop_nc*)  XIC  [2,0] (*_IO_EM_DI_03*) (*estop_no*)  OTE  [3,0] (*e_stop_active*) (**)
EOR [4,0]


(**)

SOR  [0,5] (**) (**)  
 BST  XIC  [1,0] (*_IO_EM_DI_02*) (*estop_nc*)  XIC  [2,0] (*_IO_EM_DI_03*) (*estop_no*)
   NXB  XIO  [1,1] (*_IO_EM_DI_02*) (*estop_nc*)  XIO  [2,1] (*_IO_EM_DI_03*) (*estop_no*)
 BND
  OTE  [3,0] (*estop_wiring_fault*) (**)
EOR [4,0]


(**)

SOR  [0,8] (**) (**)  XIC  [1,0] (*e_stop_ok*) (**)  
 BST  XIC  [2,0] (*_IO_EM_DI_04*) (*pb_start*)
   NXB  XIC  [2,1] (*_IO_EM_DO_02*) (**)
 BND
  OTE  [3,0] (*_IO_EM_DO_02*) (**)
EOR [4,0]


(**)

SOR  [0,11] (**) (**)  XIC  [1,0] (*amber_led_flash*) (*pending_accept*)  OTE  [2,0] (*_IO_EM_DO_04*) (*amber_light*)
EOR [4,0]


(**)

SOR  [0,13] (**) (**)  XIC  [1,0] (*_IO_EM_DI_01*) (*dir_rev_sw*)  XIO  [2,0] (*_IO_EM_DI_00*) (*dir_fwd_sw*)  OTE  [3,0] (*_IO_EM_DO_05*) (**)
EOR [4,0]


(**)

SOR  [0,15] (**) (**)  XIC  [1,0] (*_IO_EM_DO_02*) (**)  OTE  [2,0] (*_IO_EM_DO_00*) (*green_light*)
EOR [3,0]


(**)

SOR  [0,17] (**) (**)  XIO  [1,0] (*e_stop_ok*) (**)  OTE  [2,0] (*_IO_EM_DO_01*) (*red_light*)
EOR [3,0]
EOF
#end_info
END_PROGRAM

