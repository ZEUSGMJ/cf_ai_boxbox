interface Props {
  refinedQuery: string;
}

export default function RefinedQueryLabel({ refinedQuery }: Props) {
  return (
    <p className="mt-2 px-1 text-[0.68rem] italic leading-5 text-slate-500">
      Interpreted as: {refinedQuery}
    </p>
  );
}
